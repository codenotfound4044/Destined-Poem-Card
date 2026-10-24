// Install as a global Tavern Helper script, outside the character's seven scripts.
import { createReceiver, canonical, base64ToBytes } from "./receiver.mjs";
import { requestHostJSON } from "./http.mjs";

const serviceUrl = new URL(import.meta.url);
const { io } = await import(
  new URL("/socket.io/socket.io.esm.min.js", serviceUrl.origin).href
);
const tavern = window.parent?.SillyTavern ? window.parent : window;
const context = () => tavern.SillyTavern.getContext();
const helper = tavern.TavernHelper ?? window.TavernHelper;
const problem = (code, message, details) =>
  Object.assign(new Error(message), { code, details });
if (!tavern.SillyTavern || !helper)
  throw problem(
    "MISSING_HOST_API",
    "请在安装酒馆助手的酒馆全局脚本库运行同步工具",
  );

async function request(endpoint, body, method = "POST") {
  return requestHostJSON(
    () =>
      tavern.fetch(new URL(endpoint, tavern.location.origin), {
        method,
        headers: context().getRequestHeaders(),
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      }),
    endpoint,
  );
}
function exactPatch(old, desired) {
  const patch = {};
  for (const key of new Set([
    ...Object.keys(old ?? {}),
    ...Object.keys(desired ?? {}),
  ])) {
    if (!Object.hasOwn(desired, key)) patch[key] = "__@@UNSET@@__";
    else if (
      desired[key] &&
      typeof desired[key] === "object" &&
      !Array.isArray(desired[key])
    )
      patch[key] = exactPatch(old?.[key], desired[key]);
    else patch[key] = desired[key];
  }
  return patch;
}
async function readCharacter(id) {
  const character = await request("/api/characters/get", { avatar_url: id });
  // json_data is the complete stored card, unlike helper's deliberately reduced Character view.
  if (typeof character?.json_data !== "string")
    throw problem("HOST_FORMAT", "角色卡响应缺少完整 json_data");
  const card = JSON.parse(character.json_data);
  card.avatar = id; // ST's runtime file identity; stored cards may originally use the sentinel 'none'.
  return card;
}
async function listWorldbooks() {
  const result = await request("/api/worldinfo/list", {});
  if (!Array.isArray(result))
    throw problem("HOST_FORMAT", "世界书列表响应格式无效");
  return result.map((item) => item.file_id);
}
async function environment() {
  const user = await request("/api/users/me", undefined, "GET");
  return {
    origin: tavern.location.origin,
    user: user?.handle ?? null,
    helperVersion: await helper.getTavernHelperVersion(),
  };
}
const adapter = {
  environment,
  async listCharacters() {
    const values = await request("/api/characters/all", {});
    if (!Array.isArray(values))
      throw problem("HOST_FORMAT", "角色卡列表响应格式无效");
    return values.map((character) => ({
      name: character.name,
      id: character.avatar,
      worldbook: character.data?.extensions?.world || null,
    }));
  },
  readCharacter,
  listWorldbooks,
  readWorldbook: (name) => request("/api/worldinfo/get", { name }),
  convertWorldbook(book) {
    if (typeof context().convertCharacterBook !== "function")
      throw problem(
        "MISSING_HOST_API",
        "当前酒馆缺少 convertCharacterBook；需要项目锁定的 SillyTavern 1.19.0",
      );
    return context().convertCharacterBook(book);
  },
  async writeCharacter(id, card) {
    const current = await readCharacter(id);
    const patch = exactPatch(current, card);
    await request("/api/characters/merge-attributes", { ...patch, avatar: id });
  },
  async writeWorldbook(name, data) {
    await request("/api/worldinfo/edit", { name, data });
    // Native API refreshes cache and emits WORLDINFO_UPDATED. Its fetch does not check status,
    // so the checked write above and persisted read below are deliberately required too.
    await context().saveWorldInfo(name, structuredClone(data), true);
    if (
      canonical(await request("/api/worldinfo/get", { name })) !==
      canonical(data)
    )
      throw problem("VERIFY_FAILED", "世界书保存后读回不一致");
  },
  async deleteWorldbook(name) {
    await request("/api/worldinfo/delete", { name });
    await context().updateWorldInfoList();
  },
  async refresh(id, worldbookName, card) {
    await context().getOneCharacter(id);
    await context().updateWorldInfoList();
    context().reloadWorldInfoEditor?.(worldbookName);
    const ctx = context();
    if (ctx.characters[ctx.characterId]?.avatar === id) {
      const settings = Array.isArray(card.data.extensions.tavern_helper)
        ? Object.fromEntries(card.data.extensions.tavern_helper)
        : card.data.extensions.tavern_helper;
      // Refresh the helper store through public APIs without render_character, which can
      // regenerate/save the currently displayed greeting. Never touch chat/message variables.
      helper.replaceVariables(structuredClone(settings.variables ?? {}), {
        type: "character",
      });
      helper.replaceScriptTrees(structuredClone(settings.scripts ?? []), {
        type: "character",
      });
      // Store watchers persist asynchronously. Wait for their round-trip before verification.
      let matched = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const saved = await readCharacter(id);
        if (
          canonical(saved.data.extensions.tavern_helper) === canonical(settings)
        ) {
          matched = true;
          break;
        }
      }
      if (!matched)
        throw problem("HELPER_REFRESH_FAILED", "酒馆助手脚本缓存刷新未完成");
      await context().getOneCharacter(id);
    }
    await ctx.eventSource.emit(ctx.eventTypes.CHARACTER_EDITED, {
      detail: {
        id: String(ctx.characters.findIndex((item) => item.avatar === id)),
        character: ctx.characters.find((item) => item.avatar === id),
      },
    });
  },
  async readAvatar(id) {
    const response = await tavern.fetch(
      new URL(`/characters/${encodeURIComponent(id)}`, tavern.location.origin),
      { cache: "no-store" },
    );
    if (!response.ok)
      throw problem("HOST_HTTP", `读取头像返回 ${response.status}`, {
        status: response.status,
      });
    return new Uint8Array(await response.arrayBuffer());
  },
  async writeAvatar(id, base64) {
    const form = new FormData();
    form.append(
      "avatar",
      new Blob([base64ToBytes(base64)], { type: "image/png" }),
      "avatar.png",
    );
    form.append("avatar_url", id);
    const response = await tavern.fetch(
      new URL("/api/characters/edit-avatar", tavern.location.origin),
      {
        method: "POST",
        headers: context().getRequestHeaders({ omitContentType: true }),
        body: form,
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw problem("HOST_HTTP", `更换头像返回 ${response.status}`, {
        status: response.status,
        detail: (await response.text()).slice(0, 500),
      });
    // 和酒馆自己换头像时一样，刷新缩略图和页面上已有的头像图片。
    const thumbnail = `/thumbnail?type=avatar&file=${encodeURIComponent(id)}`;
    await Promise.allSettled([
      tavern.fetch(thumbnail, { cache: "reload" }),
      tavern.fetch(`/characters/${encodeURIComponent(id)}`, {
        cache: "reload",
      }),
    ]);
    for (const img of tavern.document.querySelectorAll(
      `img[src^="${thumbnail}"]`,
    )) {
      const src = img.src;
      img.src = "";
      img.src = src;
    }
  },
  // 解码成像素再取哈希：酒馆换头像时会重新编码 PNG，文件字节会变，画面不变。
  async imageFingerprint(base64) {
    const bitmap = await createImageBitmap(
      new Blob([base64ToBytes(base64)], { type: "image/png" }),
      { colorSpaceConversion: "none", premultiplyAlpha: "none" },
    );
    const { width, height } = bitmap;
    const canvas = new OffscreenCanvas(width, height);
    const draw = canvas.getContext("2d", { willReadFrequently: true });
    draw.drawImage(bitmap, 0, 0);
    const pixels = draw.getImageData(0, 0, width, height).data;
    bitmap.close();
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    const hex = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return `${width}x${height}:${hex}`;
  },
  notify(message, type) {
    tavern.toastr?.[type]?.(message, "命定之诗同步");
  },
};
const receiver = createReceiver(adapter);
const auth = {};
if (serviceUrl.searchParams.has("token"))
  auth.token = serviceUrl.searchParams.get("token");
const socket = io(serviceUrl.origin, { transports: ["websocket"], auth });
for (const method of ["inspect", "prepare", "apply", "restore"]) {
  socket.on(`workspace:${method}`, async (payload, acknowledge) => {
    const result = await receiver[method](payload);
    if (typeof acknowledge === "function") acknowledge(result);
  });
}
socket.on("connect", () => {
  console.info("[命定之诗同步] 已连接本地工作区", serviceUrl.origin);
  socket.emit("workspace:hello", {
    protocolVersion: 1,
    origin: tavern.location.origin,
  });
});
socket.on("connect_error", (error) =>
  console.error("[命定之诗同步] 本地连接失败", error.message),
);
socket.on("disconnect", (reason) =>
  console.info("[命定之诗同步] 已断开本地工作区", reason),
);
window.addEventListener("pagehide", () => socket.disconnect(), { once: true });
