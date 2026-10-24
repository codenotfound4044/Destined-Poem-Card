import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  attachSync,
  installer,
  errorDetails,
  SyncError,
} from "./sync/server.mjs";
import { createWorkbench } from "./workbench/api.mjs";

const root = path.resolve(import.meta.dirname, "..");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
const posix = (name) => name.replaceAll("\\", "/");
function json(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}
async function requestJSON(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new SyncError("REQUEST_FORMAT", "请求必须为 application/json");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new SyncError("REQUEST_SIZE", "同步参数过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new SyncError(
      "REQUEST_FORMAT",
      `请求 JSON 格式错误: ${error.message}`,
    );
  }
}
export function localOrigin(release) {
  const origin = new URL(release.localOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    throw new Error("localOrigin 应为本机 HTTP 地址");
  return origin;
}
const VENDOR = {
  "/vendor/vue.js": "node_modules/vue/dist/vue.esm-browser.prod.js",
  "/vendor/js-yaml.js": "node_modules/js-yaml/dist/js-yaml.min.js",
};
const STATIC_PREFIXES = [
  "dist/local/",
  "content/geography/",
  "tools/geography/editors/",
  "tools/workbench/ui/",
];
// 把请求路径映射到工作区里允许公开的文件；不在白名单内的返回 null。
export function staticFile(pathname) {
  if (pathname === "/" || pathname === "/sync/" || pathname === "/index.html")
    return "tools/workbench/ui/index.html";
  if (VENDOR[pathname]) return VENDOR[pathname];
  if (
    ["/sync/bridge.mjs", "/sync/receiver.mjs", "/sync/http.mjs"].includes(
      pathname,
    )
  )
    return "tools" + pathname;
  if (pathname.startsWith("/workbench/"))
    return "tools/workbench/ui/" + pathname.slice("/workbench/".length);
  const relative = pathname.slice(1);
  return STATIC_PREFIXES.some((prefix) => relative.startsWith(prefix))
    ? relative
    : null;
}
export function allowedStatic(pathname) {
  return staticFile(pathname) !== null;
}
export async function createWorkspaceServer({
  directory = root,
  release,
  syncOptions = {},
} = {}) {
  release ??= JSON.parse(
    await fs.readFile(path.join(directory, "release.json"), "utf8"),
  );
  const origin = localOrigin(release);
  let sync;
  let workbench;
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, origin).pathname,
      );
      const host = new URL(`http://${request.headers.host ?? origin.host}`)
        .hostname;
      if (!["127.0.0.1", "localhost"].includes(host))
        throw new SyncError("LOCAL_HOST", "工作区服务只接受本机地址");
      if (
        pathname.startsWith("/_workspace/") ||
        pathname.startsWith("/_workbench/")
      ) {
        const requestOrigin = request.headers.origin;
        if (requestOrigin && requestOrigin !== origin.origin)
          throw new SyncError("ORIGIN", "同步控制请求必须来自本机工具页");
        if (await workbench(request, response, pathname)) return;
        if (request.method === "GET" && pathname === "/_workspace/status")
          return json(response, await sync.status());
        if (
          request.method === "POST" &&
          ["/_workspace/jobs", "/_workspace/restore"].includes(pathname)
        ) {
          const job = sync.start(
            await requestJSON(request),
            pathname.endsWith("restore") ? "restore" : "sync",
          );
          return json(response, { ok: true, job }, 202);
        }
        const match = pathname.match(
          /^\/_workspace\/jobs\/([a-f0-9-]+)(\/log)?$/,
        );
        if (request.method === "GET" && match) {
          const job = sync.jobs.get(match[1]);
          if (!job)
            return json(
              response,
              {
                ok: false,
                error: {
                  code: "JOB_NOT_FOUND",
                  message:
                    "没有此任务记录；服务重启后的回执保存在 .cache/sync/receipts",
                },
              },
              404,
            );
          if (!match[2])
            return json(response, { ok: true, job: sync.publicJob(job) });
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          try {
            response.end(await fs.readFile(path.join(directory, job.logPath)));
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
            response.end("本任务没有构建日志（复用产物或尚未开始构建）。");
          }
          return;
        }
        return json(
          response,
          {
            ok: false,
            error: { code: "NOT_FOUND", message: "未知工作区 API" },
          },
          404,
        );
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        response.writeHead(405);
        response.end();
        return;
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD",
        });
        response.end();
        return;
      }
      if (pathname === "/sync/install.json") {
        response.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent("命定之诗工作区同步.json")}`,
        );
        return json(response, installer(origin.origin));
      }
      const relativeFile = staticFile(pathname);
      if (!relativeFile) {
        response.writeHead(404);
        response.end(
          "Only workspace tools and local build resources are served",
        );
        return;
      }
      const actual = await fs.realpath(path.resolve(directory, relativeFile));
      const relative = posix(path.relative(directory, actual));
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new SyncError("STATIC_PATH", "文件超出工作区");
      if (
        !Object.values(VENDOR).includes(relativeFile) &&
        relative !== posix(relativeFile)
      )
        throw new SyncError("STATIC_PATH", "文件不在静态服务目录中");
      const bytes = await fs.readFile(actual);
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(actual)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) {
      const status =
        error.code === "ENOENT"
          ? 404
          : ["ORIGIN", "LOCAL_HOST", "STATIC_PATH"].includes(error.code)
            ? 403
            : error.code === "BUSY"
              ? 409
              : error instanceof SyncError
                ? 400
                : 500;
      json(response, { ok: false, error: errorDetails(error) }, status);
    }
  });
  sync = attachSync(server, { root: directory, release, ...syncOptions });
  workbench = createWorkbench({ root: directory, sync });
  return { server, sync, origin };
}
async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--no-build"))
    throw new Error("用法: pnpm dev [--no-build]");
  if (!process.argv.includes("--no-build")) {
    const result = spawnSync(
      process.execPath,
      ["tools/card.mjs", "build", "--profile", "local"],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const { server, origin } = await createWorkspaceServer();
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `${origin.origin} 已被占用。若工作区服务已经启动，直接打开该地址；否则停止占用程序后重试。`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(Number(origin.port || 80), origin.hostname, () =>
    console.log(`工作区工具与本地资源：${origin.origin}（保持此终端运行）`),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
