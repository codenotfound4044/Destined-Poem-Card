import JSON5 from 'json5';
import { dataUrl } from './cdn';
import { fetchWithRetry } from './fetch-retry';

/** Required catalog data must fail visibly instead of becoming an empty success. */
export async function loadJson5<T>(url: string): Promise<T> {
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`数据加载失败 (${response.status}): ${url}`);
  try {
    return JSON5.parse(await response.text()) as T;
  } catch (cause) {
    throw new Error(`JSON5 数据格式错误: ${url}`, { cause });
  }
}
export const loadDataJson5 = <T>(filename: string): Promise<T> => loadJson5<T>(dataUrl(filename));
