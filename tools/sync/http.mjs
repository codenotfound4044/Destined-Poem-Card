const problem = (code, message, details) =>
  Object.assign(new Error(message), { code, details });

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
