/** 网络错误（连不上、握手失败）时的重试次数；HTTP 错误码不重试 */
const RETRIES = 2;
const RETRY_DELAY_MS = 800;

/**
 * 带重试的 fetch：部分玩家的网络连 CDN 偶尔握手失败，直接报 Failed to fetch。
 * 只在 fetch 抛错时重试，服务器返回的 404 等照常交给调用方处理。
 */
export async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}
