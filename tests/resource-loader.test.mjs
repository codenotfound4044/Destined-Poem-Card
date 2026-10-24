import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHostSafe,
  pageLoader,
  resolveResourceRoot,
  resourceConfig,
  scriptLoader,
  RESOURCE_STORAGE_KEY,
} from "../tools/lib/resource-loader.mjs";

const release = {
  repository: "example/card",
  localOrigin: "http://127.0.0.1:5173",
  assets: {
    version: "1.0.2",
    cdnOrigins: ["https://a.example.net", "https://b.example.net"],
  },
};
const config = (overrides = {}) => ({
  key: "命定之诗",
  loadedPrefix: "destiny:loaded:",
  roots: resourceConfig(release, "release").roots,
  version: "1.0.2",
  variable: "资源版本",
  storageKey: RESOURCE_STORAGE_KEY,
  timeout: 50,
  ...overrides,
});
const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
};
// 模拟酒馆 iframe 里的全局对象；ok(url) 决定哪些地址能访问。
function host(t, { ok, variables = {} }) {
  const saved = {};
  const requests = [];
  const notices = [];
  const fake = {
    fetch: async (url, options) => {
      requests.push(url);
      assert.equal(options.method, "HEAD");
      if (ok(url) === "hang")
        return new Promise((_, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
      return { ok: ok(url) === true };
    },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    getVariables: () => variables,
    toastr: { warning: (text) => notices.push(text) },
  };
  for (const [key, value] of Object.entries(fake)) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved))
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  return { requests, notices, storage: fake.localStorage };
}

test("falls back to the next CDN and remembers the one that worked", async (t) => {
  const env = host(t, {
    ok: (url) => (url.startsWith("https://a.") ? "hang" : true),
  });
  const found = await resolveResourceRoot(config(), "automation/index.js");
  assert.equal(
    found.root,
    "https://b.example.net/gh/example/card@assets-v1.0.2/dist/release",
  );
  assert.equal(env.requests.length, 2);
  assert.match(env.storage.getItem(RESOURCE_STORAGE_KEY), /^https:\/\/b\./);
  // 下次先试记住的 CDN。
  env.requests.length = 0;
  await resolveResourceRoot(config(), "automation/index.js");
  assert.deepEqual(env.requests, [
    "https://b.example.net/gh/example/card@assets-v1.0.2/dist/release/automation/index.js",
  ]);
});

test("uses the character variable version and falls back to the card default", async (t) => {
  const custom = host(t, { ok: () => true, variables: { 资源版本: { 命定之诗: "v1.1.0", 创意工坊: "9.0.0" } } });
  assert.equal(
    (await resolveResourceRoot(config(), "x.js")).version,
    "1.1.0",
  );
  assert.equal(custom.notices.length, 0);
});
test("an unpublished custom version falls back once with a notice", async (t) => {
  const env = host(t, {
    ok: (url) => url.includes("@assets-v1.0.2/"),
    variables: { 资源版本: { 命定之诗: "9.9.9" } },
  });
  const found = await resolveResourceRoot(config(), "x.js");
  assert.equal(found.version, "1.0.2");
  assert.equal(env.requests.length, 3);
  assert.match(env.notices[0], /9\.9\.9 加载不到/);
  await resolveResourceRoot(config(), "x.js");
  assert.equal(env.notices.length, 1, "同一会话只提示一次");
});
test("malformed versions are ignored and total failure lists every attempt", async (t) => {
  const env = host(t, { ok: () => false, variables: { 资源版本: { 命定之诗: "最新" } } });
  await assert.rejects(
    resolveResourceRoot(config(), "x.js"),
    (error) =>
      error.message.split("\n").length === 3 &&
      error.message.includes("a.example.net") &&
      error.message.includes("b.example.net"),
  );
  assert.match(env.notices[0], /应填写版本号/);
});
test("local mode has one root and ignores the version variable", async (t) => {
  const env = host(t, { ok: () => true, variables: { 资源版本: { 命定之诗: "2.0.0" } } });
  const local = resourceConfig(release, "local");
  const found = await resolveResourceRoot(
    config({ roots: local.roots, version: "" }),
    "automation/index.js",
  );
  assert.equal(found.root, "http://127.0.0.1:5173/dist/local");
  assert.equal(env.requests.length, 1);
});

test("generated loaders compile and survive SillyTavern regex substitution", () => {
  const loader = resourceConfig(release, "release");
  const page = pageLoader(loader, "frontend/status/index.html");
  const script = scriptLoader(loader, "automation/index.js");
  // 酒馆把 {{match}} 换成 $0，再展开 $数字 / $<名字>；加载代码不能受影响。
  const host = (text) =>
    text
      .replace(/{{match}}/gi, "$0")
      .replaceAll(/\$(\d+)|\$<([^>]+)>/g, () => "CHANGED");
  assert.equal(host(page), page);
  assert.equal(host(script), script);
  const body = page.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
  assert.doesNotThrow(() => new Function("$", body));
  assert.doesNotThrow(() => new Function(script));
  assert.ok(page.startsWith("```\n<body>") && page.endsWith("</body>\n```"));
  assert.throws(() => assertHostSafe("a = $1", "x"), /捕获组/);
  assert.throws(() => assertHostSafe("{{user}}", "x"), /宏/);
});
test("resource configuration validates versions and CDN origins", () => {
  assert.throws(
    () => resourceConfig({ ...release, assets: { version: "1.0" } }, "release"),
    /版本号格式/,
  );
  assert.throws(
    () =>
      resourceConfig(
        { ...release, assets: { version: "1.0.0", cdnOrigins: ["http://x"] } },
        "release",
      ),
    /https/,
  );
  assert.equal(
    resourceConfig(release, "local", "cdn").primaryRoot,
    "https://a.example.net/gh/example/card@assets-v1.0.2/dist/release",
  );
});

test("assets command bumps the version and only marks it published after the CDN check", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { setVersion, verify } = await import("../tools/assets.mjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "destiny-assets-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "release.json");
  await fs.writeFile(
    file,
    JSON.stringify({ ...release, assets: { ...release.assets, published: true } }),
  );
  await assert.rejects(setVersion("1.0.2", { file }), /要比当前/);
  await assert.rejects(setVersion("1.0.1", { file }), /要比当前/);
  const bumped = await setVersion("1.1.0", { file });
  assert.equal(bumped.published, false);
  assert.equal(bumped.tag, "assets-v1.1.0");
  await assert.rejects(
    verify({ file, probe: async () => ({ missing: ["automation/index.js"] }) }),
    /automation\/index\.js/,
  );
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).assets.published, false);
  const checked = await verify({
    file,
    probe: async (roots) => ({ root: roots[0], missing: [] }),
  });
  assert.equal(checked.published, true);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).assets.published, true);
});

test("own assets can live on a custom domain while third-party scripts stay on jsDelivr", async (t) => {
  const custom = {
    ...release,
    assets: {
      ...release.assets,
      roots: ["https://cdn.example.org/assets/{version}"],
    },
    dependencies: {
      workshop: {
        url: "https://testingcf.jsdelivr.net/gh/someone/workshop@2.3.1/dist/Workshop/index.js",
      },
    },
  };
  const loader = resourceConfig(custom, "release");
  assert.deepEqual(loader.roots, ["https://cdn.example.org/assets/{version}"]);
  assert.equal(loader.primaryRoot, "https://cdn.example.org/assets/1.0.2");
  const { dependencyConfig } = await import("../tools/lib/resource-loader.mjs");
  assert.deepEqual(dependencyConfig(custom, "workshop").roots, [
    "https://a.example.net/gh/someone/workshop@{version}",
    "https://b.example.net/gh/someone/workshop@{version}",
  ]);
  for (const roots of [
    [],
    ["http://cdn.example.org/assets/{version}"],
    ["https://cdn.example.org/assets/1.0.2"],
    ["https://cdn.example.org/assets/{version}/"],
    ["https://cdn.example.org/{version}/{version}"],
  ])
    assert.throws(
      () =>
        resourceConfig(
          { ...release, assets: { ...release.assets, roots } },
          "release",
        ),
      /roots|资源地址模板/,
      JSON.stringify(roots),
    );

  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { target } = await import("../tools/assets.mjs");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "destiny-target-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "release.json");
  await fs.writeFile(file, JSON.stringify(custom));
  assert.deepEqual(await target({ file }), {
    version: "1.0.2",
    tag: "assets-v1.0.2",
    root: "https://cdn.example.org/assets/1.0.2",
    prefix: "assets/1.0.2",
  });
  await fs.writeFile(file, JSON.stringify(release));
  await assert.rejects(target({ file }), /没有 roots/);
});

test("third-party scripts get their own key, keep the tag's v and share the remembered CDN", async (t) => {
  const { dependencyConfig, resourceVersions } = await import(
    "../tools/lib/resource-loader.mjs"
  );
  const withDeps = {
    ...release,
    dependencies: {
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
  const manager = dependencyConfig(withDeps, "characterManager");
  assert.deepEqual(manager.roots, [
    "https://a.example.net/gh/other/manager@v{version}",
    "https://b.example.net/gh/other/manager@v{version}",
  ]);
  assert.equal(manager.version, "0.3.7");
  assert.equal(manager.entry, "dist/runtime/index.js");
  assert.deepEqual(resourceVersions(withDeps), {
    命定之诗: "1.0.2",
    创意工坊: "2.3.1",
    自动正则: "2.3.1",
    角色管理库: "0.3.7",
  });
  assert.throws(
    () =>
      dependencyConfig(
        { ...withDeps, dependencies: { workshop: { url: "https://x.org/a.js" } } },
        "workshop",
      ),
    /gh\/仓库@版本\/路径/,
  );
  assert.throws(() => dependencyConfig(withDeps, "mvu"), /没有可切换版本/);

  const env = host(t, {
    ok: (url) => !url.startsWith("https://a."),
    variables: { 资源版本: { 角色管理库: "v0.4.0" } },
  });
  const own = await resolveResourceRoot(config(), "x.js");
  assert.match(own.root, /^https:\/\/b\./);
  env.requests.length = 0;
  const found = await resolveResourceRoot(
    config({ key: manager.key, roots: manager.roots, version: manager.version }),
    manager.entry,
  );
  assert.equal(found.root, "https://b.example.net/gh/other/manager@v0.4.0");
  assert.equal(env.requests.length, 1, "沿用自有资源记住的 CDN");
  assert.deepEqual(
    JSON.parse(globalThis.sessionStorage.getItem("destiny:loaded:角色管理库")),
    {
      version: "0.4.0",
      defaultVersion: "0.3.7",
      root: "https://b.example.net/gh/other/manager@v0.4.0",
    },
  );
});
