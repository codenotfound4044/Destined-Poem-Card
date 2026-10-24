/**
 * Asset root without a trailing slash. The card's loader sets `__destinyAssetBase`
 * to whichever CDN (or local server) it reached; the build value is the fallback
 * for pages opened without that loader.
 */
const runtimeBase = (globalThis as { __destinyAssetBase?: unknown }).__destinyAssetBase;
export const ASSET_BASE = (
  typeof runtimeBase === 'string' && runtimeBase ? runtimeBase : __DESTINY_ASSET_BASE__
).replace(/\/+$/, '');
export const assetUrl = (path: string): string => `${ASSET_BASE}/${path.replace(/^\/+/, '')}`;
export const dataUrl = (filename: string): string => assetUrl(`assets/data/${filename}`);
