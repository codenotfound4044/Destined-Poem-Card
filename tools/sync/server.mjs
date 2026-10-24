import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Server } from "socket.io";
import { cardIdentity } from "../lib/version.mjs";
import { cleanCover } from "../lib/cover.mjs";
import { assetsRelease, resourceConfig } from "../lib/resource-loader.mjs";

// 推 CDN 资源前逐个入口确认 CDN 上真的有文件，避免只改了版本号、资源却没发布。
export const CDN_ENTRIES = [
  "frontend/status/index.html",
  "frontend/home/index.html",
  "frontend/custom_start/index.html",
  "frontend/data_schema/index.js",
  "automation/index.js",
  "geography/load_compact.js",
];
export async function probeCdn(roots, entries = CDN_ENTRIES, timeout = 10000) {
  const missing = [];
  let reached;
  for (const entry of entries) {
    let ok = false;
    for (const root of reached ? [reached, ...roots] : roots) {
      try {
        const response = await fetch(`${root}/${entry}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) {
          ok = true;
          reached = root;
          break;
        }
      } catch {
        // 换下一个 CDN。
      }
    }
    if (!ok) missing.push(entry);
  }
  return { root: reached, missing };
}

export class SyncError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export function errorDetails(error) {
  return {
    code: error.code ?? "SYNC_FAILED",
    message: error.message ?? String(error),
    ...(error.details === undefined ? {} : { details: error.details }),
    ...(error.rollback === undefined ? {} : { rollback: error.rollback }),
  };
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const posix = (name) => name.replaceAll("\\", "/");

export function validateSyncCard(card) {
  const data = card?.data;
  if (!data || typeof data.name !== "string" || !data.name.trim())
    throw new SyncError("CARD_FORMAT", "角色卡缺少 data.name");
  const greetings = [data.first_mes, ...(data.alternate_greetings ?? [])];
  if (
    greetings.length !== 3 ||
    greetings.some((x) => typeof x !== "string" || !x.trim())
  )
    throw new SyncError("CARD_FORMAT", "角色卡必须含三个非空开场白");
  const scripts = data.extensions?.tavern_helper?.scripts;
  const regex = data.extensions?.regex_scripts;
  for (const [label, list, count] of [
    ["脚本", scripts, 7],
    ["基础正则", regex, 10],
  ]) {
    if (!Array.isArray(list) || list.length !== count)
      throw new SyncError("CARD_FORMAT", `${label}清单应有 ${count} 项`);
    const ids = list.map((item) => item?.id);
    if (
      ids.some((id) => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length
    )
      throw new SyncError("CARD_FORMAT", `${label} ID 缺失或重复`);
  }
  for (const item of scripts)
    if (typeof item.content !== "string" || !item.content.trim())
      throw new SyncError(
        "CARD_FORMAT",
        `脚本内容为空: ${item.name ?? item.id}`,
      );
  for (const item of regex) {
    try {
      if (typeof item.findRegex !== "string" || !item.findRegex)
        throw new Error("匹配表达式为空");
      const literal = item.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
      new RegExp(
        literal ? literal[1] : item.findRegex,
        literal ? literal[2] : undefined,
      );
    } catch (error) {
      throw new SyncError(
        "REGEX_FORMAT",
        `正则「${item.scriptName ?? item.id}」格式错误: ${error.message}`,
      );
    }
  }
  if (
    !Array.isArray(data.character_book?.entries) ||
    !data.character_book.entries.length
  )
    throw new SyncError("CARD_FORMAT", "角色卡缺少世界书条目");
  return {
    greetings: greetings.length,
    scripts: scripts.length,
    baseRegex: regex.length,
    entries: data.character_book.entries.length,
  };
}

export function installer(origin) {
  return {
    type: "script",
    enabled: true,
    name: "命定之诗工作区同步（独立工具）",
    id: "b30c082c-0be3-42f5-9435-959cd6bc7954",
    content: `import '${origin}/sync/bridge.mjs';`,
    info: "装在酒馆助手的全局脚本中，开启后连接本机工作区。此工具不随角色卡打包。",
    button: { enabled: true, buttons: [] },
    data: {},
    export_with: { data: false, button: true },
  };
}

async function buildCard(root, profile, logPath, assetSource) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const log = await fs.open(logPath, "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "tools/card.mjs",
          "build",
          "--profile",
          profile,
          ...(assetSource ? ["--assets", assetSource] : []),
        ],
        {
          cwd: root,
          stdio: ["ignore", log.fd, log.fd],
          windowsHide: true,
        },
      );
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new SyncError(
                "BUILD_FAILED",
                `构建失败（退出码 ${code}），酒馆未写入`,
                { log: posix(path.relative(root, logPath)) },
              ),
            ),
      );
    });
  } finally {
    await log.close();
  }
}

export class SyncCoordinator {
  constructor({
    root,
    release,
    io,
    ackTimeout = 45000,
    // 预检、写入和恢复要整份读写卡和世界书，酒馆较慢时一次就要几十秒，单独放宽。
    writeTimeout = 240000,
    build = buildCard,
    probe = probeCdn,
  }) {
    Object.assign(this, {
      root,
      release,
      io,
      ackTimeout,
      writeTimeout,
      build,
      probe,
    });
    this.jobs = new Map();
    this.activeJob = null;
    this.defaults = null;
  }
  async ask(socket, event, data = {}) {
    let reply;
    const timeout =
      event === "workspace:inspect" ? this.ackTimeout : this.writeTimeout;
    try {
      reply = await socket.timeout(timeout).emitWithAck(event, data);
    } catch (error) {
      throw new SyncError(
        "ACK_TIMEOUT",
        event === "workspace:inspect"
          ? `酒馆没有回应「${event}」，请检查连接`
          : `酒馆在 ${Math.round(timeout / 1000)} 秒内没有确认「${event}」完成，可能仍在写入或已经断开。请先在酒馆里确认这张卡的内容，再决定重新推送还是用备份恢复；不会自动重试写入。`,
        { reason: error.message, timeoutMs: timeout },
      );
    }
    if (!reply || typeof reply.ok !== "boolean")
      throw new SyncError(
        "PROTOCOL_ERROR",
        "连接脚本返回了无法识别的结果，请更新独立同步脚本",
      );
    if (!reply.ok) {
      const failure = new SyncError(
        reply.error?.code ?? "HOST_ERROR",
        reply.error?.message ?? "酒馆操作失败",
        reply.error?.details,
      );
      failure.rollback = reply.error?.rollback;
      throw failure;
    }
    return reply;
  }
  clients() {
    return [...this.io.sockets.sockets.values()].filter(
      (socket) => socket.connected,
    );
  }
  async inspect(socket) {
    // 多个工作台页面轮询同一酒馆时，共用当前查询，避免撞上接收端的互斥锁。
    if (socket.workspaceInspection) return socket.workspaceInspection;
    socket.workspaceInspection = (async () => {
      try {
        const reply = await this.ask(socket, "workspace:inspect");
        const { ok, ...info } = reply;
        socket.workspaceInfo = {
          id: socket.id,
          ...info,
          environment: {
            ...info.environment,
            origin:
              socket.handshake?.headers?.origin ?? info.environment?.origin,
          },
        };
      } catch (error) {
        socket.workspaceInfo = {
          id: socket.id,
          environment: { origin: socket.handshake?.headers?.origin },
          error: errorDetails(error),
        };
      }
      return socket.workspaceInfo;
    })();
    try {
      return await socket.workspaceInspection;
    } finally {
      delete socket.workspaceInspection;
    }
  }
  async status() {
    if (!this.defaults) {
      try {
        this.defaults = JSON.parse(
          await fs.readFile(
            path.join(this.root, ".cache/sync/target.json"),
            "utf8",
          ),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        this.defaults = {};
      }
    }
    // 发版命令会改 release.json，这里每次重新读，避免显示旧版本号。
    const release = JSON.parse(
      await fs.readFile(path.join(this.root, "release.json"), "utf8"),
    );
    const identity = cardIdentity(release);
    let assets;
    try {
      const info = assetsRelease(release);
      assets = { version: info.version, tag: info.tag, published: info.published };
    } catch (error) {
      assets = { error: error.message };
    }
    const clients = this.activeJob
      ? this.clients().map((s) => s.workspaceInfo ?? { id: s.id })
      : await Promise.all(this.clients().map((s) => this.inspect(s)));
    return {
      ok: true,
      origin: this.release.localOrigin,
      card: {
        name: identity.name,
        version: identity.version,
        worldbookName: identity.worldbook,
      },
      assets,
      defaults: {
        characterName: identity.name,
        worldbookName: identity.worldbook,
        ...this.defaults,
      },
      clients,
      recentJobs: [...this.jobs.values()]
        .slice(-10)
        .map((job) => this.publicJob(job)),
    };
  }
  socket(clientId) {
    const clients = this.clients();
    if (clientId) {
      const match = clients.find((item) => item.id === clientId);
      if (!match)
        throw new SyncError(
          "CLIENT_DISCONNECTED",
          "选中的酒馆连接已断开，请重新检查连接",
        );
      return match;
    }
    if (!clients.length)
      throw new SyncError(
        "NO_CLIENT",
        "没有连接的酒馆。请在酒馆助手全局脚本中开启独立同步工具，并保持酒馆页面打开。",
      );
    if (clients.length !== 1)
      throw new SyncError(
        "MULTIPLE_CLIENTS",
        "多个酒馆页面已连接，请选择目标页面或传入 --client",
        clients.map((socket) => ({
          id: socket.id,
          environment: socket.workspaceInfo?.environment,
        })),
      );
    return clients[0];
  }
  publicJob(job) {
    const { request, socket, ...publicData } = job;
    return publicData;
  }
  start(request = {}, kind = "sync") {
    if (this.activeJob)
      throw new SyncError("BUSY", "已有构建或同步正在进行，请等待结果");
    if (typeof request !== "object" || request === null)
      throw new SyncError("REQUEST_FORMAT", "同步参数应为对象");
    const profile = request.profile ?? "local";
    if (!["local", "release"].includes(profile))
      throw new SyncError("PROFILE", "profile 仅支持 local 或 release");
    if (profile === "release" && !this.release.published)
      throw new SyncError(
        "UNPUBLISHED",
        "发布候选引用的 CDN 尚未发布，请使用 local 联调，或完成正式发布后同步",
      );
    const assetSource =
      request.assetSource ?? (profile === "release" ? "cdn" : "local");
    if (!["local", "cdn"].includes(assetSource))
      throw new SyncError("ASSET_SOURCE", "资源来源仅支持 local 或 cdn");
    if (profile === "release" && assetSource !== "cdn")
      throw new SyncError("ASSET_SOURCE", "release 构建只能使用 CDN 资源");
    const socket = this.socket(request.clientId);
    const job = {
      id: randomUUID(),
      kind,
      state: "running",
      phase: "starting",
      startedAt: new Date().toISOString(),
      request: { ...request, profile, assetSource },
      socket,
    };
    job.logPath = `.cache/sync/logs/${job.id}.log`;
    this.jobs.set(job.id, job);
    this.activeJob = job.id;
    this.run(job)
      .catch((error) => {
        job.state = "failed";
        job.error = errorDetails(
          new SyncError(
            "RECEIPT_WRITE",
            "无法保存本地同步回执，请检查磁盘；酒馆的实际写入结果请查看现有结果与备份",
            { reason: error.message, result: job.result },
          ),
        );
      })
      .finally(() => {
        this.activeJob = null;
      });
    return this.publicJob(job);
  }
  async run(job) {
    const request = job.request;
    try {
      if (job.kind !== "restore" && request.assetSource === "cdn") {
        job.phase = "remote";
        // 发版命令可能刚改过 release.json，这里重新读。
        const release = JSON.parse(
          await fs.readFile(path.join(this.root, "release.json"), "utf8"),
        );
        const assets = assetsRelease(release);
        if (!assets.published)
          throw new SyncError(
            "ASSETS_UNPUBLISHED",
            `程序资源 ${assets.version} 还没有标记为已发布。发布并核对后运行 pnpm card assets verify，再推 CDN 资源`,
          );
        const loader = resourceConfig(release, request.profile, "cdn");
        const roots = loader.roots.map((root) =>
          root.replace("{version}", loader.version),
        );
        const probed = await this.probe(roots);
        if (probed.missing.length)
          throw new SyncError(
            "CDN_MISSING",
            `CDN 上找不到资源版本 ${assets.version} 的部分文件，酒馆未写入`,
            { missing: probed.missing, roots },
          );
        job.assets = { version: assets.version, tag: assets.tag, root: probed.root };
      }
      const inspection = await this.inspect(job.socket);
      if (inspection.error)
        throw new SyncError(
          inspection.error.code,
          inspection.error.message,
          inspection.error.details,
        );
      if (job.kind === "restore") {
        job.phase = "reading-backup";
        const directory = await fs.realpath(
          path.join(this.root, ".cache/sync/backups"),
        );
        const filename = await fs.realpath(
          path.resolve(this.root, request.backupPath ?? ""),
        );
        if (
          !filename.startsWith(directory + path.sep) ||
          path.extname(filename) !== ".json"
        )
          throw new SyncError(
            "BACKUP_PATH",
            "只能恢复 .cache/sync/backups/ 中的 JSON 备份",
          );
        const saved = JSON.parse(await fs.readFile(filename, "utf8"));
        if (saved.schemaVersion !== 1 || !saved.target || !saved.backup)
          throw new SyncError("BACKUP_FORMAT", "不是工作区同步备份");
        if (
          saved.environment?.origin !== inspection.environment?.origin ||
          saved.environment?.user !== inspection.environment?.user
        )
          throw new SyncError(
            "BACKUP_TARGET",
            "备份所属酒馆或用户与当前连接不同，停止恢复",
          );
        job.phase = "restore";
        const reply = await this.ask(job.socket, "workspace:restore", {
          target: saved.target,
          backup: saved.backup,
        });
        if (reply.verified !== true)
          throw new SyncError(
            "VERIFY_REQUIRED",
            "酒馆没有返回恢复后的读回校验结果",
          );
        job.result = {
          ...reply,
          backupPath: posix(path.relative(this.root, filename)),
        };
      } else {
        if (!request.noBuild) {
          job.phase = "build";
          await this.build(
            this.root,
            request.profile,
            path.join(this.root, job.logPath),
            request.assetSource,
          );
        }
        job.phase = "validate";
        const directory = path.join(this.root, "dist", request.profile);
        const report = JSON.parse(
          await fs.readFile(path.join(directory, "report.json"), "utf8"),
        );
        const raw = await fs.readFile(
          path.join(directory, "命定之诗与黄昏之歌.json"),
        );
        const card = JSON.parse(raw);
        if (report.profile !== request.profile || report.sha256 !== digest(raw))
          throw new SyncError(
            "ARTIFACT_MISMATCH",
            "角色卡与构建报告哈希不一致，请重新构建",
          );
        if ((report.assetSource ?? "local") !== request.assetSource)
          throw new SyncError(
            "ARTIFACT_MISMATCH",
            "现有产物的资源来源和这次选择的不一样，请重新构建",
          );
        validateSyncCard(card);
        const target = {
          characterName: request.characterName || card.data.name,
          worldbookName:
            request.worldbookName ||
            request.characterName ||
            card.data.extensions.world,
        };
        if (
          Object.values(target).some(
            (value) => typeof value !== "string" || !value.trim(),
          )
        )
          throw new SyncError("TARGET_NAME", "角色卡和世界书名称不能为空");
        job.phase = "prepare";
        // 封面取自构建出的 PNG 角色卡，去掉卡数据只留画面，推送时替换酒馆头像。
        let avatar;
        try {
          avatar = {
            data: cleanCover(
              await fs.readFile(path.join(directory, "命定之诗与黄昏之歌.png")),
            ).bytes.toString("base64"),
          };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          throw new SyncError(
            "ARTIFACT_MISSING",
            "构建产物里没有 PNG 角色卡（缺封面？），请重新构建",
          );
        }
        const payload = { operationId: job.id, card, target, avatar };
        const prepared = await this.ask(
          job.socket,
          "workspace:prepare",
          payload,
        );
        if (!prepared.backup || !prepared.targetFingerprint)
          throw new SyncError(
            "PROTOCOL_ERROR",
            "酒馆没有返回完整备份及目标指纹，停止写入",
          );
        if (request.dryRun) {
          job.result = {
            dryRun: true,
            target,
            summary: prepared.summary,
            cardSha256: report.sha256,
          };
        } else {
          job.phase = "backup";
          const backupPath = `.cache/sync/backups/${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${job.id}.json`;
          await fs.mkdir(path.join(this.root, ".cache/sync/backups"), {
            recursive: true,
          });
          const saved = {
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
            source: { profile: request.profile, cardSha256: report.sha256 },
            target,
            environment: inspection.environment,
            backup: prepared.backup,
          };
          await fs.writeFile(
            path.join(this.root, backupPath),
            JSON.stringify(saved, null, 2) + "\n",
            { flag: "wx" },
          );
          job.backupPath = backupPath;
          job.phase = "apply";
          const applied = await this.ask(job.socket, "workspace:apply", {
            ...payload,
            targetFingerprint: prepared.targetFingerprint,
          });
          if (applied.verified !== true)
            throw new SyncError(
              "VERIFY_REQUIRED",
              "酒馆没有返回写入后的读回校验结果，请检查备份与实际目标",
            );
          job.result = {
            ...applied,
            target,
            summary: prepared.summary,
            backupPath,
            cardSha256: report.sha256,
          };
          this.defaults = target;
          await fs.writeFile(
            path.join(this.root, ".cache/sync/target.json"),
            JSON.stringify(target, null, 2) + "\n",
          );
        }
      }
      job.state = "succeeded";
      job.phase = "complete";
    } catch (error) {
      job.state = "failed";
      job.error = errorDetails(error);
      if (job.backupPath) job.error.backupPath = job.backupPath;
    } finally {
      job.finishedAt = new Date().toISOString();
      await fs.mkdir(path.join(this.root, ".cache/sync/receipts"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(this.root, ".cache/sync/receipts", job.id + ".json"),
        JSON.stringify(this.publicJob(job), null, 2) + "\n",
      );
    }
  }
}

export function attachSync(server, options) {
  const io = new Server(server, {
    cors: { origin: true, methods: ["GET", "POST"] },
    maxHttpBufferSize: 20 * 1024 * 1024,
    pingTimeout: 60000,
  });
  const coordinator = new SyncCoordinator({ ...options, io });
  io.on("connection", (socket) => {
    coordinator.inspect(socket);
  });
  return coordinator;
}
