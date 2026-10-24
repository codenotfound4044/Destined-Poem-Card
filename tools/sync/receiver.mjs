// Browser-independent synchronization contract. Host methods must read persisted data.
const clone = (value) => structuredClone(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (code, message, details) => {
  throw Object.assign(new Error(message), { code, details });
};
// 「[去古风]」开头的正则默认关闭，玩家在酒馆里自行开关；同步时保留酒馆里的开关状态。
const OPTIONAL_REGEX_PREFIX = "[去古风]";
const optionalRegex = (rule) =>
  typeof rule?.scriptName === "string" &&
  rule.scriptName.startsWith(OPTIONAL_REGEX_PREFIX);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function fingerprint(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
// 头像（封面）：只比较画面像素，PNG 里的文字块（卡数据）不算。
const TEXT_CHUNKS = new Set(["tEXt", "iTXt", "zTXt"]);
export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function stripImageText(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((b, i) => bytes[i] !== b))
    fail("AVATAR_FORMAT", "头像不是 PNG 图片");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) fail("AVATAR_FORMAT", "头像 PNG 数据不完整");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!TEXT_CHUNKS.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
function helper(value) {
  return Array.isArray(value) ? Object.fromEntries(value) : (value ?? {});
}
function flatten(scripts) {
  return scripts.flatMap((script) =>
    script.type === "folder" ? flatten(script.scripts ?? []) : [script],
  );
}
function mergeData(old, source) {
  const result = clone(object(old) ? old : {});
  for (const [key, value] of Object.entries(source ?? {})) {
    result[key] = object(value) ? mergeData(result[key], value) : clone(value);
  }
  return result;
}
function assertIds(items, label) {
  if (
    !items.every(
      (item) => object(item) && typeof item.id === "string" && item.id,
    )
  )
    fail("INVALID_CARD", `${label}缺少稳定 id`);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    fail("INVALID_CARD", `${label}存在重复 id`);
}
function validateTarget(target) {
  if (
    !object(target) ||
    ![target.characterName, target.worldbookName].every(
      (name) =>
        typeof name === "string" &&
        name.trim() &&
        !/[\\/\0<>:"|?*]/.test(name) &&
        name !== "." &&
        name !== "..",
    )
  ) {
    fail(
      "INVALID_TARGET",
      "角色卡和世界书目标必须是完整名称，且不能包含路径字符",
    );
  }
}
function validateCard(card) {
  if (!object(card) || card.spec !== "chara_card_v3" || !object(card.data))
    fail("INVALID_CARD", "同步输入必须是构建生成的 CCv3 JSON");
  const data = card.data;
  if (typeof data.name !== "string" || !data.name.trim())
    fail("INVALID_CARD", "构建角色卡缺少名称");
  if (
    typeof data.first_mes !== "string" ||
    !Array.isArray(data.alternate_greetings) ||
    data.alternate_greetings.length !== 2 ||
    !data.alternate_greetings.every((value) => typeof value === "string")
  )
    fail("INVALID_CARD", "角色卡必须包含三条开场白");
  if (
    !object(data.character_book) ||
    !Array.isArray(data.character_book.entries)
  )
    fail("INVALID_CARD", "角色卡缺少完整世界书");
  const scripts = helper(data.extensions?.tavern_helper).scripts;
  const regex = data.extensions?.regex_scripts;
  if (
    !Array.isArray(scripts) ||
    flatten(scripts).length !== 7 ||
    !Array.isArray(regex) ||
    regex.filter((rule) => !optionalRegex(rule)).length !== 10
  )
    fail("INVALID_CARD", "本工作区同步输入必须包含七个脚本和十条基础正则");
  assertIds(flatten(scripts), "脚本");
  assertIds(regex, "正则");
  for (const script of flatten(scripts))
    if (
      typeof script.content !== "string" ||
      !object(script.data) ||
      !object(script.button) ||
      !Array.isArray(script.button.buttons)
    )
      fail("INVALID_CARD", "脚本内容、运行数据或按钮格式无效", {
        id: script.id,
      });
  for (const rule of regex) {
    if (
      typeof rule.findRegex !== "string" ||
      typeof rule.replaceString !== "string" ||
      !Array.isArray(rule.placement)
    )
      fail("INVALID_CARD", "正则格式无效", { id: rule.id });
    try {
      // Match the pinned ST 1.19 regexFromString semantics, including bare patterns
      // and its fallback to a literal pattern when slash-form flags are invalid.
      const match = rule.findRegex.match(/(\/?)(.+)\1([a-z]*)/i);
      if (!match) throw Error("模式为空");
      if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3]))
        new RegExp(rule.findRegex);
      else new RegExp(match[2], match[3]);
    } catch (error) {
      fail(
        "INVALID_CARD",
        `正则 ${rule.scriptName ?? rule.id} 无效: ${error.message}`,
      );
    }
  }
  const entries = data.character_book.entries;
  if (
    !entries.every(
      (entry) =>
        object(entry) &&
        typeof entry.content === "string" &&
        Array.isArray(entry.keys),
    )
  )
    fail("INVALID_CARD", "世界书条目格式无效");
  const ids = entries.map((entry, index) => entry.id ?? index);
  if (new Set(ids).size !== ids.length)
    fail("INVALID_CARD", "世界书条目 id 重复");
}
function buildCharacter(old, source, target) {
  const result = { ...clone(old), ...clone(source) };
  // These fields identify the installed character and its current chat, not build metadata.
  for (const key of [
    "avatar",
    "chat",
    "create_date",
    "date_added",
    "date_last_chat",
    "chat_size",
  ]) {
    if (Object.hasOwn(old, key)) result[key] = clone(old[key]);
    else delete result[key];
  }
  delete result.json_data;
  result.name = target.characterName;
  result.data = {
    ...clone(old.data ?? {}),
    ...clone(source.data),
    name: target.characterName,
  };
  const previous = old.data?.extensions ?? {};
  const incoming = source.data.extensions ?? {};
  const oldHelper = helper(previous.tavern_helper);
  const newHelper = helper(incoming.tavern_helper);
  const oldScripts = new Map(
    flatten(oldHelper.scripts ?? []).map((script) => [script.id, script]),
  );
  const preserveScriptData = (script) =>
    script.type === "folder"
      ? { ...clone(script), scripts: script.scripts.map(preserveScriptData) }
      : {
          ...clone(script),
          data: mergeData(oldScripts.get(script.id)?.data, script.data),
        };
  const managedIds = new Set(incoming.regex_scripts.map((rule) => rule.id));
  const oldRegex = new Map(
    (previous.regex_scripts ?? []).map((rule) => [rule.id, rule]),
  );
  const keepOptionalToggle = (rule) => {
    const old = oldRegex.get(rule.id);
    return optionalRegex(rule) && old && typeof old.disabled === "boolean"
      ? { ...clone(rule), disabled: old.disabled }
      : clone(rule);
  };
  result.data.extensions = {
    ...clone(previous),
    ...clone(incoming),
    world: target.worldbookName,
    tavern_helper: {
      ...clone(oldHelper),
      ...clone(newHelper),
      // 构建卡里带的角色变量（地图标记、地图绘制、开局预设等）以工作区为准整体替换；
      // 只在酒馆运行时产生、卡里没有的变量（如状态栏主题）保留。
      variables: {
        ...clone(oldHelper.variables ?? {}),
        ...clone(newHelper.variables ?? {}),
      },
      scripts: newHelper.scripts.map(preserveScriptData),
    },
    regex_scripts: [
      ...incoming.regex_scripts.map(keepOptionalToggle),
      ...clone(
        (previous.regex_scripts ?? []).filter(
          (rule) => !managedIds.has(rule.id),
        ),
      ),
    ],
  };
  result.data.character_book = {
    ...clone(source.data.character_book),
    name: target.worldbookName,
  };
  return result;
}
function errorResult(error, rollback) {
  return {
    ok: false,
    error: {
      code: error.code ?? "HOST_ERROR",
      message: error.message ?? String(error),
      ...(error.details !== undefined ? { details: error.details } : {}),
      ...(rollback ? { rollback } : {}),
    },
  };
}
export function createReceiver(host) {
  let busy = false;
  const prepared = new Map();
  async function avatarSnapshot(id) {
    const data = bytesToBase64(stripImageText(await host.readAvatar(id)));
    return { data, fingerprint: await host.imageFingerprint(data) };
  }
  async function targetSnapshot(target, withAvatar = false) {
    validateTarget(target);
    const candidates = (await host.listCharacters()).filter(
      (item) => item.name === target.characterName,
    );
    if (candidates.length === 0)
      fail(
        "CHARACTER_NOT_FOUND",
        `未找到同名角色卡 '${target.characterName}'；请先导入一次`,
      );
    if (candidates.length > 1)
      fail(
        "AMBIGUOUS_CHARACTER",
        `存在 ${candidates.length} 张同名角色卡，无法选择覆盖目标`,
        { characters: candidates },
      );
    const character = candidates[0];
    if (typeof character.id !== "string" || !character.id.endsWith(".png"))
      fail("INVALID_TARGET", "角色头像文件标识无效");
    const environment = await host.environment();
    const card = await host.readCharacter(character.id);
    const names = await host.listWorldbooks();
    const worldbook = names.includes(target.worldbookName)
      ? await host.readWorldbook(target.worldbookName)
      : null;
    return {
      schemaVersion: 1,
      target: clone(target),
      environment,
      ...(withAvatar ? { avatar: await avatarSnapshot(character.id) } : {}),
      character: { id: character.id, name: character.name, card },
      worldbook:
        worldbook === null
          ? null
          : { name: target.worldbookName, data: worldbook },
    };
  }
  async function verifyAvatar(id, fingerprint, code = "VERIFY_FAILED") {
    if ((await avatarSnapshot(id)).fingerprint !== fingerprint)
      fail(code, "头像读回的画面和预期不一致");
  }
  async function verify(id, card, worldbookName, worldbook) {
    const [savedCharacter, savedWorldbook] = await Promise.all([
      host.readCharacter(id),
      host.readWorldbook(worldbookName),
    ]);
    if (
      canonical(savedCharacter) !== canonical(card) ||
      canonical(savedWorldbook) !== canonical(worldbook)
    )
      fail("VERIFY_FAILED", "后端读回内容与同步内容不一致");
  }
  async function restoreResources(backup) {
    const errors = [];
    // Restore both resources even if the first attempt fails.
    try {
      if (backup.worldbook)
        await host.writeWorldbook(
          backup.target.worldbookName,
          clone(backup.worldbook.data),
        );
      else if (
        (await host.listWorldbooks()).includes(backup.target.worldbookName)
      )
        await host.deleteWorldbook(backup.target.worldbookName);
    } catch (error) {
      errors.push({ resource: "worldbook", message: error.message });
    }
    try {
      await host.writeCharacter(
        backup.character.id,
        clone(backup.character.card),
      );
    } catch (error) {
      errors.push({ resource: "character", message: error.message });
    }
    if (backup.avatar)
      try {
        await host.writeAvatar(backup.character.id, backup.avatar.data);
      } catch (error) {
        errors.push({ resource: "avatar", message: error.message });
      }
    try {
      await host.refresh?.(
        backup.character.id,
        backup.target.worldbookName,
        clone(backup.character.card),
      );
    } catch (error) {
      errors.push({ resource: "refresh", message: error.message });
    }
    try {
      const actualCharacter = await host.readCharacter(backup.character.id);
      if (canonical(actualCharacter) !== canonical(backup.character.card))
        fail("ROLLBACK_VERIFY_FAILED", "角色卡回滚读回不一致");
      const exists = (await host.listWorldbooks()).includes(
        backup.target.worldbookName,
      );
      if (backup.worldbook) {
        if (
          !exists ||
          canonical(await host.readWorldbook(backup.target.worldbookName)) !==
            canonical(backup.worldbook.data)
        )
          fail("ROLLBACK_VERIFY_FAILED", "世界书回滚读回不一致");
      } else if (exists) fail("ROLLBACK_VERIFY_FAILED", "新建世界书未移除");
      if (backup.avatar)
        await verifyAvatar(
          backup.character.id,
          backup.avatar.fingerprint,
          "ROLLBACK_VERIFY_FAILED",
        );
    } catch (error) {
      errors.push({ resource: "verification", message: error.message });
    }
    return { ok: errors.length === 0, errors };
  }
  async function exclusive(action) {
    if (busy)
      return errorResult(
        Object.assign(new Error("另一次同步操作正在进行"), { code: "BUSY" }),
      );
    busy = true;
    try {
      return await action();
    } catch (error) {
      return errorResult(error);
    } finally {
      busy = false;
    }
  }
  return {
    inspect: () =>
      exclusive(async () => ({
        ok: true,
        environment: await host.environment(),
        characters: await host.listCharacters(),
        worldbooks: await host.listWorldbooks(),
      })),
    prepare: (request) =>
      exclusive(async () => {
        const { operationId, card, target, avatar } = request ?? {};
        if (typeof operationId !== "string" || !operationId)
          fail("INVALID_REQUEST", "缺少 operationId");
        validateTarget(target);
        validateCard(card);
        let desiredAvatar = null;
        if (avatar !== undefined) {
          if (!object(avatar) || typeof avatar.data !== "string" || !avatar.data)
            fail("INVALID_REQUEST", "头像数据格式无效");
          const data = bytesToBase64(stripImageText(base64ToBytes(avatar.data)));
          desiredAvatar = { data, fingerprint: await host.imageFingerprint(data) };
        }
        const backup = await targetSnapshot(target, desiredAvatar !== null);
        const targetFingerprint = await fingerprint(backup);
        const desired = buildCharacter(backup.character.card, card, target);
        const worldbook = await host.convertWorldbook(
          clone(desired.data.character_book),
        );
        const summary = {
          characterName: target.characterName,
          characterId: backup.character.id,
          worldbookName: target.worldbookName,
          worldbookEntries: card.data.character_book.entries.length,
          greetings: 3,
          scripts: 7,
          managedRegex: card.data.extensions.regex_scripts.length,
          preservedRegex:
            desired.data.extensions.regex_scripts.length -
            card.data.extensions.regex_scripts.length,
          worldbookCreated: backup.worldbook === null,
          avatar: desiredAvatar
            ? desiredAvatar.fingerprint === backup.avatar.fingerprint
              ? "unchanged"
              : "replace"
            : "skip",
        };
        // Only one prepared operation is needed; prevents stale prepares accumulating indefinitely.
        prepared.clear();
        prepared.set(operationId, {
          backup,
          targetFingerprint,
          requestFingerprint: await fingerprint({ card, target }),
          desired,
          worldbook,
          avatar: desiredAvatar,
          summary,
        });
        return {
          ok: true,
          operationId,
          backup: clone(backup),
          targetFingerprint,
          summary,
        };
      }),
    apply: (request) =>
      exclusive(async () => {
        const { operationId, card, target, targetFingerprint } = request ?? {};
        const plan = prepared.get(operationId);
        if (
          !plan ||
          plan.targetFingerprint !== targetFingerprint ||
          (await fingerprint({ card, target })) !== plan.requestFingerprint
        )
          fail("PREPARE_REQUIRED", "同步内容与已备份的预检不一致，请重新预检");
        const withAvatar = plan.avatar !== null;
        const current = await targetSnapshot(target, withAvatar);
        if ((await fingerprint(current)) !== targetFingerprint)
          fail("TARGET_CHANGED", "预检后酒馆数据已发生变化，请重新预检和备份");
        prepared.delete(operationId);
        try {
          await host.writeWorldbook(
            target.worldbookName,
            clone(plan.worldbook),
          );
          await host.writeCharacter(
            plan.backup.character.id,
            clone(plan.desired),
          );
          // 换头像要在写卡之后：酒馆会把当前卡数据重新写进新图片。
          if (withAvatar && plan.summary.avatar === "replace")
            await host.writeAvatar(plan.backup.character.id, plan.avatar.data);
          await host.refresh?.(
            plan.backup.character.id,
            target.worldbookName,
            clone(plan.desired),
          );
          await verify(
            plan.backup.character.id,
            plan.desired,
            target.worldbookName,
            plan.worldbook,
          );
          if (withAvatar)
            await verifyAvatar(plan.backup.character.id, plan.avatar.fingerprint);
          host.notify?.(
            "同步并读回校验成功；刷新酒馆页面后查看完整界面更新",
            "success",
          );
          return {
            ok: true,
            operationId,
            summary: plan.summary,
            targetFingerprint: await fingerprint(
              await targetSnapshot(target, withAvatar),
            ),
            verified: true,
          };
        } catch (error) {
          const rollback = await restoreResources(plan.backup);
          host.notify?.(
            rollback.ok
              ? "同步失败，已回滚"
              : "同步失败，回滚不完整，请使用备份恢复",
            "error",
          );
          return errorResult(error, rollback);
        }
      }),
    restore: (request) =>
      exclusive(async () => {
        const { backup, target } = request ?? {};
        validateTarget(target);
        if (
          !object(backup) ||
          backup.schemaVersion !== 1 ||
          canonical(backup.target) !== canonical(target) ||
          !object(backup.character?.card) ||
          !object(backup.environment) ||
          backup.character.name !== target.characterName ||
          backup.character.card.data?.name !== target.characterName ||
          (backup.character.card.name !== undefined &&
            backup.character.card.name !== target.characterName) ||
          (backup.worldbook !== null &&
            (!object(backup.worldbook?.data) ||
              !object(backup.worldbook.data.entries) ||
              backup.worldbook.name !== target.worldbookName))
        )
          fail("INVALID_BACKUP", "备份格式或目标不匹配");
        if (
          backup.avatar !== undefined &&
          (!object(backup.avatar) ||
            typeof backup.avatar.data !== "string" ||
            typeof backup.avatar.fingerprint !== "string")
        )
          fail("INVALID_BACKUP", "备份里的头像数据无效");
        const current = await targetSnapshot(target);
        if (
          current.character.id !== backup.character.id ||
          current.environment.origin !== backup.environment.origin ||
          current.environment.user !== backup.environment.user
        )
          fail(
            "BACKUP_TARGET_MISMATCH",
            "备份属于不同的酒馆、用户或角色头像标识",
          );
        const rollback = await restoreResources(backup);
        if (!rollback.ok)
          return errorResult(
            Object.assign(new Error("备份恢复未通过读回校验"), {
              code: "RESTORE_FAILED",
            }),
            rollback,
          );
        return {
          ok: true,
          restored: true,
          target: clone(target),
          verified: true,
        };
      }),
  };
}
