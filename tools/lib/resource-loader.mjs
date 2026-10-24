// 卡里脚本和界面的统一加载器。
// 卡里的正则和脚本不写死单个 URL，而是内嵌同一段加载代码：
// - 依次尝试几个 CDN 域名，第一个能连上的记到 localStorage，下次优先用；
// - 角色变量「资源版本」是一个对象，每项对应一组脚本（命定之诗自有程序、创意工坊、自动正则、角色管理库），
//   玩家可以分别填版本号，不填就用卡内默认版本；填的版本加载不到时退回默认版本并提示一次；
// - 实际加载的版本记到 sessionStorage，状态栏设置页据此显示。
import { parseVersion } from "./version.mjs";

export const RESOURCE_VARIABLE = "资源版本";
export const RESOURCE_STORAGE_KEY = "destiny:resource-root";
export const LOADED_STORAGE_PREFIX = "destiny:loaded:";
export const OWN_RESOURCE_KEY = "命定之诗";
// 可以由玩家切换版本的第三方脚本：依赖角色 → 「资源版本」里的键名。
export const SWITCHABLE_DEPENDENCIES = {
  workshop: "创意工坊",
  autoRegex: "自动正则",
  characterManager: "角色管理库",
};
export const DEFAULT_CDN_ORIGINS = [
  "https://testingcf.jsdelivr.net",
  "https://cdn.jsdelivr.net",
  "https://fastly.jsdelivr.net",
  "https://gcore.jsdelivr.net",
];
export const ASSET_MODES = ["local", "cdn"];

// release.json 的 assets：程序资源自己的版本，和卡版本分开。
export function assetsRelease(release) {
  const assets = release.assets ?? {};
  const version = String(assets.version ?? "").replace(/^v/i, "");
  parseVersion(version);
  const origins = assets.cdnOrigins ?? DEFAULT_CDN_ORIGINS;
  if (!Array.isArray(origins) || !origins.length)
    throw new Error("release.json 的 assets.cdnOrigins 不能为空");
  for (const origin of origins)
    if (!/^https:\/\/[^/\s]+$/.test(origin))
      throw new Error(`CDN 域名格式应为 https://域名: ${origin}`);
  return {
    version,
    tagPrefix: assets.tagPrefix ?? "assets-v",
    published: assets.published === true,
    origins,
    tag: `${assets.tagPrefix ?? "assets-v"}${version}`,
  };
}

// 自有资源的加载器配置。local 只有本机一个地址；cdn 是各 CDN 域名下带 {version} 的资源根。
export function resourceConfig(release, profile = "local", assets) {
  const mode = assets ?? (profile === "release" ? "cdn" : "local");
  if (!ASSET_MODES.includes(mode)) throw new Error(`未知资源来源: ${mode}`);
  if (mode === "local") {
    const root = `${release.localOrigin.replace(/\/$/, "")}/dist/local`;
    return {
      key: OWN_RESOURCE_KEY,
      mode,
      roots: [root],
      version: "",
      primaryRoot: root,
    };
  }
  const info = assetsRelease(release);
  const roots = info.origins.map(
    (origin) =>
      `${origin}/gh/${release.repository}@${info.tagPrefix}{version}/dist/release`,
  );
  return {
    key: OWN_RESOURCE_KEY,
    mode,
    roots,
    version: info.version,
    tag: info.tag,
    primaryRoot: roots[0].replace("{version}", info.version),
  };
}

// 第三方脚本的加载器配置：从 release.json 里的固定链接拆出仓库、版本和文件路径。
// 只支持 jsDelivr 的 gh/仓库@版本/路径 形式，版本号前的 v 留在资源根里，玩家填不填 v 都行。
export function dependencyConfig(release, role) {
  const key = SWITCHABLE_DEPENDENCIES[role];
  const url = release.dependencies?.[role]?.url;
  if (!key || !url) throw new Error(`没有可切换版本的依赖: ${role}`);
  const match =
    /^https:\/\/[^/]+\/(gh\/[\w.-]+\/[\w.-]+)@(v?)(\d+\.\d+\.\d+)\/(.+)$/.exec(
      url,
    );
  if (!match)
    throw new Error(
      `依赖 ${role} 的链接应为 jsDelivr 的 gh/仓库@版本/路径: ${url}`,
    );
  const [, repo, prefix, version, entry] = match;
  const roots = assetsRelease(release).origins.map(
    (origin) => `${origin}/${repo}@${prefix}{version}`,
  );
  return { key, mode: "cdn", roots, version, entry };
}

// 卡里角色变量「资源版本」的初始值：各组脚本的卡内默认版本。
export function resourceVersions(release) {
  return {
    [OWN_RESOURCE_KEY]: assetsRelease(release).version,
    ...Object.fromEntries(
      Object.keys(SWITCHABLE_DEPENDENCIES).map((role) => {
        const config = dependencyConfig(release, role);
        return [config.key, config.version];
      }),
    ),
  };
}

// 运行在酒馆 iframe 里的代码，构建时用 toString() 原样嵌进卡。
// 只用普通字符串拼接：酒馆正则会处理 $数字、$<名字> 和双花括号宏，这里一律避开。
export async function resolveResourceRoot(config, entry) {
  var host = globalThis;
  var storage = null;
  try {
    storage = host.localStorage;
  } catch (error) {
    storage = null;
  }
  var roots = config.roots.slice();
  try {
    var preferred = storage && storage.getItem(config.storageKey);
    var at = -1;
    for (var i = 0; preferred && i < roots.length; i++)
      if (roots[i].indexOf(preferred + "/") === 0) at = i;
    if (at > 0) roots.unshift(roots.splice(at, 1)[0]);
  } catch (error) {
    at = -1;
  }
  var versions = [config.version];
  var custom = "";
  if (config.version) {
    try {
      var variables = host.getVariables
        ? host.getVariables({ type: "character" })
        : null;
      var chosen = variables && variables[config.variable];
      custom = String((chosen && chosen[config.key]) || "")
        .trim()
        .replace(/^v/i, "");
    } catch (error) {
      custom = "";
    }
    if (custom && !/^\d+\.\d+\.\d+$/.test(custom)) {
      notify(
        "「" +
          config.key +
          "」的版本应填写版本号，比如 " +
          config.version +
          "，这次先用卡内默认版本",
      );
      custom = "";
    }
    if (custom && custom !== config.version) versions.unshift(custom);
  }
  var tried = [];
  for (var v = 0; v < versions.length; v++) {
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r].split("{version}").join(versions[v]);
      if (await reachable(root + "/" + entry)) {
        try {
          if (storage)
            storage.setItem(
              config.storageKey,
              root.split("/").slice(0, 3).join("/"),
            );
        } catch (error) {
          storage = null;
        }
        try {
          host.sessionStorage.setItem(
            config.loadedPrefix + config.key,
            JSON.stringify({
              version: versions[v],
              defaultVersion: config.version,
              root: root,
            }),
          );
        } catch (error) {
          void error;
        }
        if (versions[v] !== versions[0])
          notify(
            "「" +
              config.key +
              "」版本 " +
              versions[0] +
              " 加载不到，这次先用卡内默认的 " +
              versions[v],
          );
        return { root: root, version: versions[v] };
      }
      tried.push(root + "/" + entry);
    }
  }
  throw new Error(
    "「" + config.key + "」加载失败，已尝试：\n" + tried.join("\n"),
  );

  async function reachable(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, config.timeout);
    try {
      var response = await host.fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      return response.ok;
    } catch (error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  function notify(text) {
    var key = config.storageKey + ":notice:" + text;
    try {
      if (host.sessionStorage.getItem(key)) return;
      host.sessionStorage.setItem(key, "1");
    } catch (error) {
      key = "";
    }
    if (host.toastr) host.toastr.warning(text);
    else console.warn(text);
  }
}

function runtimeConfig(config) {
  return JSON.stringify({
    key: config.key,
    roots: config.roots,
    version: config.version,
    variable: RESOURCE_VARIABLE,
    storageKey: RESOURCE_STORAGE_KEY,
    loadedPrefix: LOADED_STORAGE_PREFIX,
    timeout: 6000,
  });
}
// 卡里的代码要经过酒馆正则和宏替换，凡是会被改写的写法都拦下来。
export function assertHostSafe(code, label) {
  for (const [pattern, reason] of [
    [/\$\d|\$</, "含 $数字 或 $<名字>，会被酒馆正则当成捕获组"],
    [/\{\{|\}\}/, "含双花括号，会被酒馆当成宏"],
    [/```/, "含三个反引号，会提前结束代码块"],
  ])
    if (pattern.test(code)) throw new Error(`${label} 的加载代码${reason}`);
  return code;
}

// 酒馆助手脚本：先选出能连上的资源根，再动态导入入口。
// 自有资源顺带告诉页面数据目录在哪；第三方脚本不需要。
export function scriptLoader(config, entry) {
  const own = config.key === OWN_RESOURCE_KEY;
  return assertHostSafe(
    [
      `// 命定之诗加载器：CDN 回退 + 角色变量「${RESOURCE_VARIABLE}」里的「${config.key}」`,
      "(async function () {",
      `  var config = ${runtimeConfig(config)};`,
      `  var resolve = ${resolveResourceRoot.toString()};`,
      "  try {",
      `    var found = await resolve(config, ${JSON.stringify(entry)});`,
      ...(own
        ? ["    globalThis.__destinyAssetBase = found.root + '/frontend';"]
        : []),
      `    await import(found.root + ${JSON.stringify("/" + entry)});`,
      "  } catch (error) {",
      "    console.error(error);",
      "    if (globalThis.toastr) globalThis.toastr.error(String(error.message || error));",
      "  }",
      "})();",
      "",
    ].join("\n"),
    entry,
  );
}

// 正则里的界面：选出资源根后把页面载入当前 iframe，页面再从 __destinyAssetBase 取数据地址。
export function pageLoader(config, entry) {
  const body = assertHostSafe(
    [
      "<body>",
      "<script>",
      "(async function () {",
      `  var config = ${runtimeConfig(config)};`,
      `  var resolve = ${resolveResourceRoot.toString()};`,
      "  try {",
      `    var found = await resolve(config, ${JSON.stringify(entry)});`,
      "    window.__destinyAssetBase = found.root + '/frontend';",
      `    $('body').load(found.root + ${JSON.stringify("/" + entry)});`,
      "  } catch (error) {",
      "    document.body.textContent = String(error.message || error);",
      "  }",
      "})();",
      "</script>",
      "</body>",
    ].join("\n"),
    entry,
  );
  return "```\n" + body + "\n```";
}
