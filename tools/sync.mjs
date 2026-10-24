import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
export function parseSyncArgs(args) {
  const options = {};
  let command = "sync";
  if (args[0] === "status" || args[0] === "restore") command = args.shift();
  if (command === "restore") {
    if (!args[0] || args[0].startsWith("--"))
      throw new Error(
        "用法: pnpm card sync restore <backupPath> [--client id]",
      );
    options.backupPath = args.shift();
  }
  const values = {
    "--character": "characterName",
    "--worldbook": "worldbookName",
    "--client": "clientId",
    "--profile": "profile",
    "--assets": "assetSource",
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--no-build") options.noBuild = true;
    else if (values[flag]) {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw new Error(`${flag} 缺少参数`);
      options[values[flag]] = args[++i];
    } else throw new Error(`未知同步参数: ${flag}`);
  }
  return { command, options };
}
export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseSyncArgs([...args]);
  const release = JSON.parse(
    await fs.readFile(path.join(root, "release.json"), "utf8"),
  );
  const origin = new URL(release.localOrigin);
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    throw new Error("同步服务必须使用本机 HTTP localOrigin");
  async function request(route, body) {
    let response;
    try {
      response = await fetch(new URL(route, origin), {
        ...(body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw new Error(
        `无法连接工作区服务 ${origin.origin}；请先运行 pnpm dev 并保持终端打开。${error.message}`,
      );
    }
    const reply = await response.json();
    if (!response.ok || !reply.ok) {
      const error = new Error(
        reply.error?.message ?? `HTTP ${response.status}`,
      );
      error.code = reply.error?.code;
      error.details = reply.error?.details;
      throw error;
    }
    return reply;
  }
  if (command === "status") {
    console.log(JSON.stringify(await request("/_workspace/status"), null, 2));
    return;
  }
  let { job } = await request(
    command === "restore" ? "/_workspace/restore" : "/_workspace/jobs",
    options,
  );
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastPhase;
  while (job.state === "running") {
    if (job.phase !== lastPhase) {
      console.error(`[sync] ${job.phase}`);
      lastPhase = job.phase;
    }
    if (Date.now() > deadline)
      throw new Error(
        `等待同步超时；请在 ${origin.origin} 查看任务 ${job.id}，不要直接重发覆盖请求`,
      );
    await new Promise((resolve) => setTimeout(resolve, 750));
    ({ job } = await request(`/_workspace/jobs/${job.id}`));
  }
  console.log(JSON.stringify({ ok: job.state === "succeeded", job }, null, 2));
  if (job.state !== "succeeded") process.exitCode = 1;
  return job;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: error.code ?? "SYNC_CLIENT",
            message: error.message,
            details: error.details,
          },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
