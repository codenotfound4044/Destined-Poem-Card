#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  resolveSource,
  readJSON,
  readText,
  readSourceBytes,
  loadWorldbook,
  assembleCard,
  assetOrigins,
} from "./lib/card-source.mjs";
import { bundleWorldbook, run, sha256 } from "./lib/card-bundle.mjs";
import { writeCardPNG } from "./lib/png.mjs";
import { summarizeCard, compareSummaries } from "./lib/card-diff.mjs";
import {
  cardIdentity,
  contentHash,
  versionFor,
  VERSION_ENTRY_NAME,
  VERSION_PLACEHOLDER,
} from "./lib/version.mjs";
import { readCover } from "./lib/cover.mjs";
import { nestingIssues, nestingItems } from "./lib/worldbook-nesting.mjs";

async function filesAt(directory) {
  const results = [];
  for (const entry of await fs.readdir(resolveSource(directory), {
    withFileTypes: true,
  })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) results.push(...(await filesAt(name)));
    else results.push(name);
  }
  return results;
}
export async function check() {
  const { entries, references } = await loadWorldbook();
  if (!entries.length) throw new Error("世界书清单为空");
  const scripts = await readJSON("card/scripts/index.json");
  const regex = await readJSON("card/regex/index.json");
  for (const [name, list] of [
    ["脚本", scripts],
    ["正则", regex],
  ]) {
    const ids = list.map((item) => item.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !id))
      throw new Error(`${name} id 重复或缺失`);
  }
  const roles = scripts.map((script) => script.role);
  if (roles.some((role) => !role) || new Set(roles).size !== roles.length)
    throw new Error("脚本资源角色重复或缺失");
  for (const item of scripts) {
    if (!item.contentFile) throw new Error(`脚本缺少可编辑源: ${item.name}`);
    const content = await readText(item.contentFile);
    if (!content.includes(`{{${item.role}}}`))
      throw new Error(`脚本资源模板和角色不一致: ${item.name}`);
    for (const key of [
      "构建信息",
      "creative_workshop_cache",
      "char_info_runtime",
    ])
      if (key in (item.data ?? {})) throw new Error(`脚本含运行缓存: ${key}`);
  }
  for (const item of regex) {
    if (
      [
        item.replacementFile !== undefined,
        item.frontendView !== undefined,
        item.replaceString !== undefined,
      ].filter(Boolean).length !== 1
    )
      throw new Error(`正则替换来源应唯一: ${item.scriptName}`);
    if (item.replacementFile) await readText(item.replacementFile);
  }
  for (const greeting of await readJSON("card/greetings/index.json"))
    if (greeting.file) await readText(greeting.file);
  const referenced = new Set(references.map((ref) => ref.file));
  const bodyFiles = await filesAt("worldbook/命定之诗");
  const unregistered = bodyFiles.filter(
    (f) => !referenced.has(resolveSource(f)),
  );
  // 缩进挂靠检查只警告不报错：存量问题见 docs/worldbook-tree.md。
  const nesting = nestingIssues(
    await nestingItems(references, (file) => fs.readFile(file, "utf8")),
  );
  for (const issue of nesting) console.warn(`[挂靠] ${issue}`);
  const result = {
    entries: entries.length,
    enabled: entries.filter((e) => e.启用).length,
    scripts: scripts.length,
    regex: regex.length,
    unregistered,
    nesting,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
export async function map(query = "") {
  const { references } = await loadWorldbook();
  const sections = {
    卡片: "card",
    世界书: "worldbook/命定之诗.yaml",
    前端: "packages/frontend/src",
    自动化: "packages/automation/src",
    规则: "packages/game/src",
    数据: "content",
    地理: "content/geography",
    正则: "card/regex/views",
    文档: "docs",
    技能: ".agents/skills",
  };
  if (!query) {
    for (const [label, directory] of Object.entries(sections))
      console.log(`${label}\t${directory}`);
    console.log(
      `世界书: ${references.length} 条引用；用 map <关键词> 搜索文件名及文本内容。`,
    );
    return;
  }
  for (const route of await moduleRoutes(query)) {
    console.log(`关联主题: ${route.topic}`);
    for (const [field, label] of [
      ["sources", "源码"],
      ["consumers", "消费者"],
      ["generated", "生成物"],
      ["references", "资料"],
    ])
      for (const target of route[field]) console.log(`${label}\t${target}`);
  }
  const rows = references.map(
    (ref) =>
      `${ref.entry.启用 ? "启用" : "停用"} ${ref.entry.名称}\t${path.relative(ROOT, ref.file).replaceAll("\\", "/")}`,
  );
  for (const [label, directory] of Object.entries(sections)) {
    try {
      for (const file of (await fs.stat(resolveSource(directory))).isFile()
        ? [directory]
        : await filesAt(directory))
        rows.push(`${label}\t${file}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const needle = query.toLowerCase();
  for (const row of rows) {
    let matched = !needle || row.toLowerCase().includes(needle);
    if (!matched) {
      const file = row.split("\t").at(-1);
      const bytes = await readSourceBytes(file);
      if (!bytes.includes(0)) {
        try {
          matched = new TextDecoder("utf-8", { fatal: true })
            .decode(bytes)
            .toLowerCase()
            .includes(needle);
        } catch {
          /* Non-UTF8 and binary assets are excluded from text search. */
        }
      }
    }
    if (matched) console.log(row);
  }
}
export async function moduleRoutes(query) {
  const needle = query.toLowerCase();
  return (await readJSON("card/module-map.json")).filter((route) =>
    route.aliases.some((alias) => needle.includes(alias.toLowerCase())),
  );
}
async function copyIfPresent(source, target) {
  try {
    await fs.cp(resolveSource(source), target, { recursive: true });
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
export function assertProfileTarget(target, profile) {
  if (!["local", "release"].includes(profile)) throw new Error("无效构建配置");
  const profileRoot = resolveSource(`dist/${profile}`);
  const relative = path.relative(profileRoot, path.resolve(target));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error(`清理目标必须位于 dist/${profile} 内: ${target}`);
}
export async function artifactHashes(directory) {
  const results = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await artifactHashes(target)));
    else if (entry.name !== "report.json") {
      const bytes = await fs.readFile(target);
      results.push({
        path: path.relative(ROOT, target).replaceAll("\\", "/"),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
  }
  return results;
}
export async function publishSchema(
  frontendOutput,
  schemaSource = resolveSource("packages/frontend/.cache/schema.json"),
) {
  const target = path.join(frontendOutput, "data_schema/schema.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(schemaSource, target);
  return target;
}
// 世界书末尾放一条不启用的版本标记，玩家沿用旧世界书时自动化脚本能发现版本对不上。
export function addVersionEntry(book, version = VERSION_PLACEHOLDER) {
  const entries = book.entries.filter((e) => e.comment !== VERSION_ENTRY_NAME);
  const template = entries[0] ?? {};
  const id = entries.reduce((max, e) => Math.max(max, e.id ?? -1), -1) + 1;
  entries.push({
    ...structuredClone(template),
    id,
    keys: [],
    secondary_keys: [],
    comment: VERSION_ENTRY_NAME,
    content: version,
    constant: false,
    selective: false,
    enabled: false,
    insertion_order: 0,
    extensions: {
      ...structuredClone(template.extensions ?? {}),
      display_index: id,
      automation_id: "",
      triggers: [],
    },
  });
  return { ...book, entries };
}
export async function build(profile = "local") {
  const release = await readJSON("release.json");
  const { assetBase, base } = assetOrigins(release, profile);
  const stats = await check();
  const out = resolveSource(`dist/${profile}`);
  await fs.mkdir(out, { recursive: true });
  const environment = { ...process.env, DESTINY_ASSET_BASE: assetBase };
  // process.execPath + pnpm's JS entry avoids cmd.exe quoting of Unicode paths.
  const pnpm = process.env.npm_execpath;
  if (pnpm) {
    run(process.execPath, [pnpm, "--filter", "@destiny/frontend", "build"], {
      env: environment,
    });
    run(process.execPath, [pnpm, "--filter", "@destiny/automation", "build"], {
      env: environment,
    });
  } else {
    for (const pkg of ["frontend", "automation"])
      run(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["--filter", `@destiny/${pkg}`, "build"],
        {
          env: environment,
          shell: process.platform === "win32",
        },
      );
  }
  for (const pkg of ["frontend", "automation"]) {
    const target = path.join(out, pkg);
    assertProfileTarget(target, profile);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(resolveSource(`packages/${pkg}/dist`), target, {
      recursive: true,
    });
  }
  await copyIfPresent("packages/frontend/public", path.join(out, "frontend"));
  await publishSchema(path.join(out, "frontend"));
  const data = path.join(out, "frontend/assets/data");
  await fs.mkdir(data, { recursive: true });
  for (const [name, file] of Object.entries(
    await readJSON("content/manifest.json"),
  ))
    await fs.copyFile(resolveSource(file), path.join(data, name));
  const { generateGeography } = await import("./geography.mjs");
  const geography = await generateGeography({
    outputDir: path.join(out, "geography"),
  });
  const identity = cardIdentity(release);
  const book = addVersionEntry(
    await bundleWorldbook({ ...identity, version: VERSION_PLACEHOLDER }),
  );
  const draft = JSON.stringify(
    await assembleCard({
      book,
      mapMarkers: geography.mapMarkers,
      release,
      profile,
      version: VERSION_PLACEHOLDER,
    }),
    null,
    2,
  );
  // 版本号最后再填：开发版的标记取自不含版本号的内容哈希，同一份内容推几次标记都一样。
  const version = versionFor(profile, release, contentHash(draft));
  const card = JSON.parse(draft.replaceAll(VERSION_PLACEHOLDER, version));
  const output = path.join(out, "命定之诗与黄昏之歌.json");
  const bytes = Buffer.from(JSON.stringify(card, null, 2) + "\n");
  await fs.writeFile(output, bytes);
  const cover = await readCover();
  const png = path.join(out, "命定之诗与黄昏之歌.png");
  await fs.writeFile(png, writeCardPNG(cover.bytes, card));
  const scriptUrls = card.data.extensions.tavern_helper.scripts.flatMap(
    (script) =>
      [...script.content.matchAll(/https?:\/\/[^'"\s]+/g)].map((m) => m[0]),
  );
  const pageUrls = card.data.extensions.regex_scripts.flatMap((regex) =>
    [...regex.replaceString.matchAll(/https?:\/\/[^'"\s<>`]+/g)].map(
      (m) => m[0],
    ),
  );
  const dataUrls = Object.keys(await readJSON("content/manifest.json")).map(
    (name) => `${assetBase}/assets/data/${encodeURIComponent(name)}`,
  );
  const artifacts = await artifactHashes(out);
  const urls = [
    ...new Set([
      ...scriptUrls,
      ...pageUrls,
      ...dataUrls,
      `${assetBase}/data_schema/schema.json`,
    ]),
  ];
  const report = {
    profile,
    published: release.published,
    candidate: profile === "release" && !release.published,
    cardVersion: version,
    baseVersion: identity.version,
    dev: profile !== "release",
    cardName: identity.name,
    worldbookName: identity.worldbook,
    output: path.relative(ROOT, output),
    png: path.relative(ROOT, png),
    cover: { sha256: cover.sha256, width: cover.width, height: cover.height },
    sha256: sha256(bytes),
    worldbook: {
      entries: stats.entries,
      enabled: stats.enabled,
      unregistered: stats.unregistered.length,
      nesting: stats.nesting.length,
    },
    assets: { base, urls },
    validation: {
      static:
        "passed: source checks, package builds, official worldbook bundle",
      host: "not run",
      modelGeneration: "not run",
      remoteAssets: "not checked; publication is separate",
    },
  };
  report.assets.artifacts = artifacts;
  report.assets.dependencyScope =
    "Direct script imports and local generated assets only; third-party transitive dependencies are not claimed locked.";
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  return report;
}
export async function diff() {
  const baseline = await readJSON("card/baseline.json");
  const local = await readJSON("dist/local/命定之诗与黄昏之歌.json");
  const result = {
    provenance: baseline.source,
    ...compareSummaries(baseline.summary, summarizeCard(local)),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.stdout.on("error", (error) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const [command = "check", ...args] = process.argv.slice(2);
  try {
    if (command === "map") await map(args.join(" "));
    else if (command === "check") await check();
    else if (command === "build") {
      if (args.length && (args[0] !== "--profile" || args.length !== 2))
        throw new Error("用法: build [--profile local|release]");
      await build(args[1] ?? "local");
    } else if (command === "diff") await diff();
    else if (command === "sync") await (await import("./sync.mjs")).main(args);
    else if (command === "version" || command === "release")
      await (await import("./release.mjs")).main([command, ...args]);
    else
      throw new Error(
        "用法: card map [query] | check | build [--profile local|release] | diff | sync [status|--dry-run|restore <backupPath>] | version | release <版本号，如 4.3.4>",
      );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
