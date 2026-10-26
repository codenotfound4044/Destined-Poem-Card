import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { deflateSync } from "node:zlib";
import {
  assembleCard,
  assetOrigins,
  loadWorldbook,
  readJSON,
  readText,
  resolveSource,
  sourceFile,
  ROOT,
} from "../tools/lib/card-source.mjs";
import {
  assertProfileTarget,
  artifactHashes,
  publishSchema,
  moduleRoutes,
} from "../tools/card.mjs";
import { summarizeCard, compareSummaries } from "../tools/lib/card-diff.mjs";
import {
  chunk,
  parsePNG,
  readCardPNG,
  writeCardPNG,
} from "../tools/lib/png.mjs";

const release = {
  repository: "example/card",
  cardName: "命定之诗与黄昏之歌",
  version: "4.3.3",
  localOrigin: "http://127.0.0.1:5173",
  assets: {
    version: "1.0.2",
    cdnOrigins: ["https://one.example.net", "https://two.example.net"],
  },
  dependencies: {
    mvu: { url: "https://example.org/mvu.js" },
    workshop: {
      url: "https://testingcf.jsdelivr.net/gh/someone/workshop@2.3.1/dist/Workshop/index.js",
    },
    autoRegex: {
      url: "https://testingcf.jsdelivr.net/gh/someone/workshop@2.3.1/dist/Regex/index.js",
    },
    characterManager: {
      url: "https://testingcf.jsdelivr.net/gh/other/manager@v0.3.7/dist/runtime/index.js",
    },
  },
};

test("local and release resources remain distinct after both cards are assembled", async () => {
  const book = {
    name: "official",
    entries: [{ content: "https://old.example.org is narrative text" }],
  };
  const local = await assembleCard({
    book,
    mapMarkers: [{ id: "source-marker" }],
    release,
  });
  const published = await assembleCard({
    book,
    mapMarkers: [],
    release,
    profile: "release",
  });
  assert.equal(local.data.character_book, book);
  assert.equal(
    local.data.character_book.entries[0].content,
    "https://old.example.org is narrative text",
  );
  const localPage = local.data.extensions.regex_scripts[5].replaceString;
  assert.ok(localPage.includes('"roots":["http://127.0.0.1:5173/dist/local"]'));
  assert.ok(localPage.includes('"frontend/status/index.html"'));
  assert.ok(localPage.includes('"version":""'));
  const releasePage = published.data.extensions.regex_scripts[5].replaceString;
  for (const origin of ["https://one.example.net", "https://two.example.net"])
    assert.ok(
      releasePage.includes(
        `${origin}/gh/example/card@assets-v{version}/dist/release`,
      ),
    );
  assert.ok(releasePage.includes('"version":"1.0.2"'));
  assert.ok(!releasePage.includes("127.0.0.1"));
  // 本机构建也可以改用 CDN 资源，用于推送给手机等其他设备。
  const cdn = await assembleCard({
    book,
    mapMarkers: [],
    release,
    assetSource: "cdn",
  });
  assert.equal(
    cdn.data.extensions.regex_scripts[5].replaceString,
    releasePage,
  );
  assert.match(
    local.data.extensions.tavern_helper.scripts[2].content,
    /await import\(found\.root \+ "\/automation\/index\.js"\)/,
  );
  assert.match(
    local.data.extensions.tavern_helper.scripts[5].content,
    /"geography\/load_compact\.js"/,
  );
  assert.equal(
    local.data.extensions.tavern_helper.scripts[1].content.trim(),
    "import 'https://example.org/mvu.js';",
  );
  assert.deepEqual(local.data.extensions.tavern_helper.variables, {
    map_markers: [{ id: "source-marker" }],
    map_drawings: [],
    status_edit_enabled: false,
    start_presets: { presets: [] },
    资源版本: {
      命定之诗: "1.0.2",
      创意工坊: "2.3.1",
      自动正则: "2.3.1",
      角色管理库: "0.3.7",
    },
  });
  assert.throws(() => assetOrigins(release, "other"), /未知构建配置/);
  assert.throws(
    () => assetOrigins(release, "release", "local"),
    /只能使用 CDN/,
  );
});

test("source ordering, IDs, extension metadata and editable regex replacements survive assembly", async () => {
  const source = await readJSON("card/scripts/index.json");
  const regex = await readJSON("card/regex/index.json");
  assert.equal(source.length, 7);
  assert.equal(regex.length, 10);
  const meta = await readJSON("card/meta.json");
  const card = await assembleCard({
    book: { entries: [] },
    mapMarkers: [],
    release,
  });
  assert.deepEqual(
    card.data.extensions.tavern_helper.scripts.map((s) => [
      s.id,
      s.enabled,
      s.button,
    ]),
    source.map((s) => [s.id, s.enabled, s.button]),
  );
  assert.deepEqual(
    card.data.extensions.regex_scripts.map((r) => r.id),
    regex.map((r) => r.id),
  );
  assert.equal(
    card.data.extensions.regex_scripts[8].replaceString,
    await readText(regex[8].replacementFile),
  );
  assert.deepEqual(
    card.data.extensions["xiaobaix-template"],
    meta.data.extensions["xiaobaix-template"],
  );
  assert.equal(card.first_mes, "【首页】");
  assert.equal(card.data.first_mes, "【首页】");
  assert.equal(
    card.data.alternate_greetings[0],
    "<customized>\n自定义开局开始\n</customized>",
  );
  assert.equal(
    card.data.alternate_greetings[1],
    (await readText("card/greetings/线与天堂与彼岸花.txt")).replace(
      /\r\n/g,
      "\n",
    ),
  );
});

test("source references and destructive cleanup cannot escape their assigned roots", async () => {
  assert.throws(() => resolveSource("../outside.js"), /边界/);
  assert.throws(() => resolveSource("imports/cloud/source.js"), /边界/);
  await assert.rejects(() => sourceFile("../../outside.txt", ROOT), /边界/);
  assert.doesNotThrow(() =>
    assertProfileTarget(path.join(ROOT, "dist/local/frontend"), "local"),
  );
  assert.throws(
    () =>
      assertProfileTarget(path.join(ROOT, "dist/release/frontend"), "local"),
    /清理目标/,
  );
  assert.throws(
    () => assertProfileTarget(path.join(ROOT, "dist/local"), "local"),
    /清理目标/,
  );
});

test("PNG export carries matching V2 and V3 data and replaces previous card chunks", () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const image = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(5))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: { name: "一致性" },
  };
  const result = writeCardPNG(writeCardPNG(image, card), card);
  const records = parsePNG(result)
    .filter((c) => c.type === "tEXt")
    .map((c) => ({
      key: c.data.toString("latin1", 0, c.data.indexOf(0)),
      card: JSON.parse(
        Buffer.from(
          c.data.subarray(c.data.indexOf(0) + 1).toString("ascii"),
          "base64",
        ).toString("utf8"),
      ),
    }));
  assert.deepEqual(
    records.map((r) => r.key),
    ["chara", "ccv3"],
  );
  assert.deepEqual(records[0].card.data, records[1].card.data);
  assert.equal(records[0].card.spec, "chara_card_v2");
  assert.deepEqual(readCardPNG(result).card, card);
});

test("official worldbook manifest resolves every entry without enabling unregistered files", async () => {
  const { entries, references } = await loadWorldbook();
  assert.equal(entries.length, 555);
  assert.equal(entries.filter((e) => e.启用).length, 434);
  assert.equal(references.length, 555);
  assert.ok(references.some((r) => r.file.endsWith("variables.ejs")));
});

test("generated schema is published and hashed while old reports are excluded", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "destiny-card-"));
  try {
    const source = path.join(temp, "schema-source.json");
    const frontend = path.join(temp, "frontend");
    await fs.writeFile(source, '{"type":"object"}\n');
    const generated = await publishSchema(frontend, source);
    await fs.writeFile(
      path.join(frontend, "report.json"),
      "old report must not hash itself",
    );
    const artifacts = await artifactHashes(frontend);
    assert.equal(await fs.readFile(generated, "utf8"), '{"type":"object"}\n');
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].path.endsWith("/frontend/data_schema/schema.json"));
    assert.match(artifacts[0].sha256, /^[0-9a-f]{64}$/);
    await fs.writeFile(
      path.join(frontend, "report.json"),
      "a different previous report",
    );
    assert.deepEqual(await artifactHashes(frontend), artifacts);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("tracked cloud baseline contains no runtime data and supports structural differences", async () => {
  const baseline = await readJSON("card/baseline.json");
  assert.match(baseline.source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(baseline.summary.scripts.length, 7);
  assert.equal(baseline.summary.regex.length, 10);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(
        ![
          "data",
          "variables",
          "creative_workshop_cache",
          "char_info_runtime",
        ].includes(key),
        `baseline contains ${key}`,
      );
      inspect(child);
    }
  }
  inspect(baseline);
  const fixture = {
    data: {
      name: "test",
      character_version: "v1",
      first_mes: "first\r\nline",
      alternate_greetings: ["second"],
      character_book: {
        entries: [{ id: 1, comment: "entry", content: "text", enabled: true }],
      },
      extensions: {
        world: "world",
        tavern_helper: {
          variables: { secret: "PRIVATE_SENTINEL" },
          scripts: [
            {
              id: "script",
              name: "script",
              enabled: true,
              content: "code",
              button: { enabled: true, buttons: [] },
              data: { creative_workshop_cache: "PRIVATE_SENTINEL" },
            },
          ],
        },
        regex_scripts: [
          {
            id: "regex",
            scriptName: "regex",
            disabled: false,
            findRegex: "find",
            replaceString: "replace",
          },
        ],
      },
    },
  };
  const before = summarizeCard(fixture);
  assert.ok(!JSON.stringify(before).includes("PRIVATE_SENTINEL"));
  fixture.data.first_mes = "changed";
  fixture.data.extensions.tavern_helper.scripts[0].content = "new code";
  fixture.data.extensions.regex_scripts[0].findRegex = "new pattern";
  fixture.data.character_book.entries[0].content = "new text";
  fixture.data.character_book.entries.push({
    id: 2,
    comment: "new entry",
    content: "new",
    enabled: false,
  });
  const difference = compareSummaries(before, summarizeCard(fixture));
  assert.ok(difference.greetings.changed[0].fields.includes("sha256"));
  assert.ok(difference.scripts.changed[0].fields.includes("contentSha256"));
  assert.ok(difference.regex.changed[0].fields.includes("findRegex"));
  assert.equal(difference.worldbook.added[0].name, "new entry");
  assert.ok(difference.worldbook.changed[0].fields.includes("contentSha256"));
});

test("topic navigation connects source, consumers, generated assets and references", async () => {
  const routes = await moduleRoutes("地图");
  assert.equal(routes.length, 1);
  assert.ok(routes[0].sources.includes("content/geography/"));
  for (const field of ["sources", "consumers", "generated", "references"])
    assert.ok(routes[0][field].length);
  assert.deepEqual(await moduleRoutes("a-topic-not-registered"), []);
});
