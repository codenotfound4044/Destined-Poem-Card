const problem = (code, message, details) =>
  Object.assign(new Error(message), { code, details });

const cacheLoading = (response) =>
  (response.headers.get("x-cocktail-plus-state") ??
    response.headers.get("x-cocktail-cache")) === "ASYNC-MISS";
const retryDelay = (response) =>
  Math.min(
    1000,
    Math.max(
      100,
      Number(response.headers.get("x-cocktail-plus-retry-after-ms")) || 1000,
    ),
  );
const isCharacterList = (input, origin) => {
  try {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
      origin,
    );
    return url.origin === origin && url.pathname === "/api/characters/all";
  } catch {
    return false;
  }
};

// 酒馆自己的 getCharacters 不认识 cocktail-plus 的占位空列表：当前打开的卡不在列表里，
// 就会弹「当前角色已不再可用」并刷新页面。推送改写卡以后缓存要重建一阵，
// 这期间从最近聊天等入口进卡都会碰上。连接脚本启用期间，只给角色列表这一个只读接口
// 加一层有界重读：占位响应时稍等再取，最多 10 次，其余请求原样放行。
export function guardCharacterList(win) {
  if (win.__destinyCharacterListGuard) return win.fetch;
  const original = win.fetch.bind(win);
  const guarded = async (input, init) => {
    let response = await original(input, init);
    if (!isCharacterList(input, win.location.origin)) return response;
    for (let attempt = 0; attempt < 10 && cacheLoading(response); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response)));
      response = await original(input, init);
    }
    return response;
  };
  win.__destinyCharacterListGuard = true;
  win.fetch = guarded;
  return guarded;
}

// cocktail-plus 的 ASYNC-MISS 是缓存重建中的占位响应，不是真正的空角色列表。
// 只重读角色列表；任何写请求、HTTP 错误都不重试。
export async function requestHostJSON(send, endpoint) {
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    const text = await response.text();
    if (!response.ok)
      throw problem(
        response.status === 401 || response.status === 403
          ? "HOST_AUTH"
          : "HOST_HTTP",
        `${endpoint} 返回 ${response.status}`,
        { status: response.status, detail: text.slice(0, 2000) },
      );
    const cacheState =
      response.headers.get("x-cocktail-plus-state") ??
      response.headers.get("x-cocktail-cache");
    if (endpoint === "/api/characters/all" && cacheState === "ASYNC-MISS") {
      if (attempt === 9)
        throw problem(
          "HOST_CACHE_LOADING",
          "酒馆仍在重建角色列表，请稍后重新检查；尚未确认角色是否存在",
        );
      const retryAfter = Number(
        response.headers.get("x-cocktail-plus-retry-after-ms"),
      );
      const delay = Math.min(1000, Math.max(100, retryAfter || 1000));
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
