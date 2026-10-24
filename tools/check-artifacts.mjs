import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import JSON5 from "json5";
import {
  ROOT,
  readJSON,
  assetOrigins,
  resolveSource,
  OWN_SCRIPT_ENTRIES,
} from "./lib/card-source.mjs";
import { sha256 } from "./lib/card-bundle.mjs";
import { readCardPNG } from "./lib/png.mjs";
import { cardIdentity, VERSION_ENTRY_NAME } from "./lib/version.mjs";
import { RESOURCE_VARIABLE, resourceVersions } from "./lib/resource-loader.mjs";

const OWN_ROLES = new Set(Object.keys(OWN_SCRIPT_ENTRIES));

const withoutVersionEntry = (book) => ({
  ...book,
  entries: book.entries.filter((e) => e.comment !== VERSION_ENTRY_NAME),
});

export async function checkArtifacts() {
  const release = await readJSON("release.json");
  const sources = await readJSON("content/manifest.json");
  const scripts = await readJSON("card/scripts/index.json");
  const regex = await readJSON("card/regex/index.json");
  const greetings = await readJSON("card/greetings/index.json");
  const profiles = [];
  let localBook;
  for (const profile of ["local", "release"]) {
    const report = await readJSON(`dist/${profile}/report.json`);
    const card = await readJSON(`dist/${profile}/命定之诗与黄昏之歌.json`);
    const { base, assetBase, loader } = assetOrigins(
      release,
      profile,
      report.assetSource,
    );
    if (profile === "release") assert.equal(loader.mode, "cdn");
    assert.equal(report.assets.base, base);
    const identity = cardIdentity(release);
    const version = card.data.character_version;
    assert.equal(report.cardVersion, version);
    if (profile === "release") assert.equal(version, identity.version);
    else assert.ok(version.startsWith(`${identity.version}+dev.`), version);
    assert.equal(card.data.name, identity.name);
    assert.equal(card.data.extensions.world, identity.worldbook);
    assert.equal(card.data.character_book.name, identity.worldbook);
    const marker = card.data.character_book.entries.filter(
      (e) => e.comment === VERSION_ENTRY_NAME,
    );
    assert.equal(marker.length, 1, "世界书应有且只有一条版本标记");
    assert.equal(marker[0].content, version);
    assert.equal(marker[0].enabled, false);
    const embedded = readCardPNG(
      await fs.readFile(resolveSource(`dist/${profile}/命定之诗与黄昏之歌.png`)),
    ).card;
    assert.deepEqual(embedded, card, "PNG 角色卡内的数据应与 JSON 一致");
    assert.equal(1 + card.data.alternate_greetings.length, greetings.length);
    assert.deepEqual(
      card.data.extensions.tavern_helper.scripts.map((item) => item.id),
      scripts.map((item) => item.id),
    );
    assert.deepEqual(
      card.data.extensions.regex_scripts.map((item) => item.id),
      regex.map((item) => item.id),
    );
    // 自有入口都要走同一套加载器配置，不能残留写死的单个地址。
    const roots = JSON.stringify(loader.roots);
    const loaders = [
      ...card.data.extensions.regex_scripts
        .filter((item, index) => regex[index].frontendView)
        .map((item) => item.replaceString),
      ...card.data.extensions.tavern_helper.scripts
        .filter((item, index) => OWN_ROLES.has(scripts[index].role))
        .map((item) => item.content),
    ];
    assert.equal(loaders.length, 3 + OWN_ROLES.size);
    for (const code of loaders) assert.ok(code.includes(roots), "加载器资源根不一致");
    assert.deepEqual(
      card.data.extensions.tavern_helper.variables[RESOURCE_VARIABLE],
      resourceVersions(release),
    );
    if (profile === "local")
      localBook = withoutVersionEntry(card.data.character_book);
    else
      assert.deepEqual(
        withoutVersionEntry(card.data.character_book),
        localBook,
        "世界书不得随发布资源profile变化",
      );

    for (const artifact of report.assets.artifacts) {
      assert.ok(artifact.path.startsWith(`dist/${profile}/`));
      assert.notEqual(path.basename(artifact.path), "report.json");
      const bytes = await fs.readFile(resolveSource(artifact.path));
      assert.equal(bytes.length, artifact.bytes, artifact.path);
      assert.equal(sha256(bytes), artifact.sha256, artifact.path);
      if (/\.(js|html)$/.test(artifact.path)) {
        const code = bytes.toString("utf8");
        assert.doesNotMatch(
          code,
          /(?:from\s*|import\s*\(?\s*)['"](?:@destiny\/|https?:\/\/[^'"\s]*\/npm\/@destiny\/)/,
          `${artifact.path}: workspace package must be bundled`,
        );
        assert.doesNotMatch(
          code,
          /(?:from\s*|import\s*\(?\s*)['"]https?:\/\/[^'"\s]*\/npm\/zod(?:@|\/|['"])/,
          `${artifact.path}: use host Zod`,
        );
        assert.ok(
          !code.includes(
            "FrontEnd-for-destined-journey@main/public/assets/data/",
          ),
          `${artifact.path}: catalog requests must use the workspace asset root`,
        );
        if (loader.mode === "cdn")
          assert.ok(
            !code.includes(release.localOrigin),
            `${artifact.path}: CDN build contains local resource origin`,
          );
        else
          assert.ok(
            !code.includes(`${release.repository}@`),
            `${artifact.path}: local build contains CDN resource origin`,
          );
      }
    }
    let ownUrls = 0;
    for (const url of report.assets.urls.filter((url) =>
      url.startsWith(base + "/"),
    )) {
      const relative = decodeURIComponent(url.slice(base.length + 1));
      assert.ok(!relative.split("/").includes(".."));
      assert.ok(
        (await fs.stat(resolveSource(`dist/${profile}/${relative}`))).isFile(),
        url,
      );
      ownUrls += 1;
    }
    for (const [name, file] of Object.entries(sources)) {
      const original = await fs.readFile(resolveSource(file));
      const generated = await fs.readFile(
        resolveSource(`dist/${profile}/frontend/assets/data/${name}`),
      );
      assert.deepEqual(generated, original, name);
      if (name.endsWith(".json")) JSON5.parse(generated.toString("utf8"));
    }
    const schema = await readJSON(
      `dist/${profile}/frontend/data_schema/schema.json`,
    );
    assert.ok(
      schema.properties?.主角 && schema.properties?.世界,
      "generated schema must describe the stat_data value",
    );
    assert.ok(
      (
        await fs.readFile(
          resolveSource(`dist/${profile}/frontend/data_schema/index.js`),
          "utf8",
        )
      ).includes(release.dependencies.mvuZod.url),
      "Schema registrar must use the release manifest URL",
    );
    assert.ok(
      (
        await fs.readFile(
          resolveSource(`dist/${profile}/frontend/custom_start/index.html`),
          "utf8",
        )
      ).includes(assetBase),
    );
    profiles.push({
      profile,
      artifacts: report.assets.artifacts.length,
      ownUrls,
      entries: card.data.character_book.entries.length,
      published: report.published,
      cardSha256: report.sha256,
    });
  }
  return {
    ok: true,
    profiles,
    host: "separate validation; not inferred from builds",
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(ROOT, "tools/check-artifacts.mjs")
) {
  try {
    console.log(JSON.stringify(await checkArtifacts(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
