// 程序资源版本：和卡版本分开记在 release.json 的 assets 里。
//   pnpm card assets               看当前资源版本、标签和是否已标记发布
//   pnpm card assets set 1.0.1     改资源版本（会把 published 置回 false）
//   pnpm card assets verify        到 CDN 逐个入口核对，全部能访问才标记为已发布
import fs from "node:fs/promises";
import { resolveSource } from "./lib/card-source.mjs";
import { parseVersion } from "./lib/version.mjs";
import { assetsRelease, resourceConfig } from "./lib/resource-loader.mjs";
import { probeCdn, CDN_ENTRIES } from "./sync/server.mjs";

const RELEASE = resolveSource("release.json");
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const write = (file, data) =>
  fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");

export async function status({ file = RELEASE } = {}) {
  const release = await read(file);
  const info = assetsRelease(release);
  const loader = resourceConfig(release, "release", "cdn");
  return {
    version: info.version,
    tag: info.tag,
    published: info.published,
    roots: loader.roots.map((root) => root.replace("{version}", info.version)),
  };
}
export async function setVersion(target, { file = RELEASE } = {}) {
  const release = await read(file);
  const current = assetsRelease(release);
  const next = String(target ?? "").replace(/^v/i, "");
  const a = parseVersion(next);
  const b = parseVersion(current.version);
  if ((a.major - b.major || a.minor - b.minor || a.patch - b.patch) <= 0)
    throw new Error(`新资源版本要比当前的 ${current.version} 大`);
  release.assets = { ...release.assets, version: next, published: false };
  await write(file, release);
  return status({ file });
}
export async function verify({ probe = probeCdn, file = RELEASE } = {}) {
  const info = await status({ file });
  const result = await probe(info.roots, CDN_ENTRIES);
  if (result.missing.length) {
    const error = new Error(
      `CDN 上找不到资源版本 ${info.version}（标签 ${info.tag}）的这些文件：${result.missing.join("、")}。确认标签已推送且包含 dist/release/** 后再试。`,
    );
    error.details = result;
    throw error;
  }
  const release = await read(file);
  release.assets = { ...release.assets, published: true };
  await write(file, release);
  return { ...info, published: true, reached: result.root };
}
export async function main([command = "status", ...args] = []) {
  const actions = {
    status: () => status(),
    set: () => setVersion(args[0]),
    verify: () => verify(),
  };
  if (!actions[command])
    throw new Error("用法: card assets [status | set <版本号> | verify]");
  console.log(JSON.stringify(await actions[command](), null, 2));
}
