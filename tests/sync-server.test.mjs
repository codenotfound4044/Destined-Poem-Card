import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import {
  SyncCoordinator,
  validateSyncCard,
  installer,
} from "../tools/sync/server.mjs";
import { createWorkspaceServer } from "../tools/dev.mjs";
import { parseSyncArgs } from "../tools/sync.mjs";
import { parseSourceJSON } from "../tools/lib/card-source.mjs";

const root = path.resolve(import.meta.dirname, "..");
function cardFixture() {
  return {
    spec: "chara_card_v3",
    data: {
      name: "测试角色",
      first_mes: "【首页】",
      alternate_greetings: [
        "<customized>自定义开局开始</customized>",
        "进入彼岸",
      ],
      character_book: { entries: [{ content: "世界" }] },
      extensions: {
        world: "测试世界书",
        tavern_helper: {
          scripts: Array.from({ length: 7 }, (_, i) => ({
            id: `s${i}`,
            content: `import '${i}.js'`,
          })),
        },
        regex_scripts: Array.from({ length: 10 }, (_, i) => ({
          id: `r${i}`,
          scriptName: `正则${i}`,
          findRegex: i ? "【首页】" : "/<x>(.*?)<\\/x>/gs",
        })),
      },
    },
  };
}
async function fixture(t, handlers = {}, options = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "destiny-sync-test-"),
  );
  t.after(async () => {
    assert.ok(
      path
        .resolve(directory)
        .startsWith(path.resolve(os.tmpdir(), "destiny-sync-test-")),
    );
    await fs.rm(directory, { recursive: true, force: true });
  });
  const data = cardFixture();
  const bytes = Buffer.from(JSON.stringify(data));
  await fs.mkdir(path.join(directory, "dist/local"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "dist/local/命定之诗与黄昏之歌.json"),
    bytes,
  );
  await fs.copyFile(
    new URL("../card/cover/cover.png", import.meta.url),
    path.join(directory, "dist/local/命定之诗与黄昏之歌.png"),
  );
  await fs.writeFile(
    path.join(directory, "release.json"),
    JSON.stringify({ cardName: "测试卡", version: "1.2.3" }),
  );
  await fs.writeFile(
    path.join(directory, "dist/local/report.json"),
    JSON.stringify({
      profile: "local",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  const events = [];
  const socket = {
    id: "test-client",
    connected: true,
    handshake: { headers: { origin: "http://127.0.0.1:8019" } },
    timeout() {
      return this;
    },
    async emitWithAck(event, payload) {
      events.push(event);
      if (handlers[event]) return handlers[event](payload, directory);
      if (event === "workspace:inspect")
        return {
          ok: true,
          environment: { origin: "http://127.0.0.1:8019", user: "test" },
          characters: [{ name: "测试角色", id: "test.png" }],
          worldbooks: ["测试世界书"],
        };
      if (event === "workspace:prepare")
        return {
          ok: true,
          backup: { original: true },
          targetFingerprint: "snapshot",
          summary: { scripts: 7 },
        };
      if (event === "workspace:apply" || event === "workspace:restore")
        return { ok: true, verified: true };
      throw new Error(event);
    },
  };
  const io = { sockets: { sockets: new Map([[socket.id, socket]]) } };
  const coordinator = new SyncCoordinator({
    root: directory,
    release: { localOrigin: "http://127.0.0.1:5173", published: false },
    io,
    build: async () => {},
    ...options,
  });
  async function run(request = {}, kind = "sync") {
    const initial = coordinator.start({ noBuild: true, ...request }, kind);
    while (coordinator.activeJob)
      await new Promise((resolve) => setTimeout(resolve, 5));
    return coordinator.jobs.get(initial.id);
  }
  return { directory, data, events, socket, coordinator, run };
}

test("sync validation accepts ST bare and literal regex and names malformed rules", () => {
  const card = cardFixture();
  assert.equal(validateSyncCard(card).scripts, 7);
  card.data.extensions.regex_scripts[1].findRegex = "[";
  assert.throws(() => validateSyncCard(card), /正则「正则1」格式错误/);
});
test("source JSON diagnostics retain filename and native line/column", () => {
  assert.throws(
    () => parseSourceJSON('{\n"broken":\n}', "card/scripts/index.json"),
    (error) =>
      error.code === "SOURCE_FORMAT" &&
      error.message.includes("card/scripts/index.json") &&
      /line|position|行/.test(error.message),
  );
});
test("CLI rejects unknown flags and preserves explicit target and restore filename", () => {
  assert.deepEqual(parseSyncArgs(["--character", "旧卡名", "--dry-run"]), {
    command: "sync",
    options: { characterName: "旧卡名", dryRun: true },
  });
  assert.equal(
    parseSyncArgs(["restore", ".cache/sync/backups/a.json", "--client", "a"])
      .options.clientId,
    "a",
  );
  assert.throws(() => parseSyncArgs(["--character"]), /缺少参数/);
  assert.throws(() => parseSyncArgs(["--force"]), /未知/);
});
test("independent installer is a global-tool script and uses floating local bridge", () => {
  const script = installer("http://127.0.0.1:5173");
  assert.equal(script.type, "script");
  assert.match(script.content, /http:\/\/127.0.0.1:5173\/sync\/bridge\.mjs/);
});
test("zero or multiple clients never silently select an overwrite target", async (t) => {
  const { coordinator, socket } = await fixture(t);
  coordinator.io.sockets.sockets.clear();
  assert.throws(() => coordinator.start({}), { code: "NO_CLIENT" });
  coordinator.io.sockets.sockets.set("a", socket);
  coordinator.io.sockets.sockets.set("b", { ...socket, id: "b" });
  assert.throws(() => coordinator.start({}), { code: "MULTIPLE_CLIENTS" });
  assert.throws(() => coordinator.start({ clientId: "gone" }), {
    code: "CLIENT_DISCONNECTED",
  });
});
test("dry run prepares but never saves a backup or invokes apply", async (t) => {
  const { run, directory, events } = await fixture(t);
  const job = await run({ dryRun: true });
  assert.equal(job.state, "succeeded");
  assert.equal(job.result.dryRun, true);
  assert.deepEqual(events, ["workspace:inspect", "workspace:prepare"]);
  await assert.rejects(fs.access(path.join(directory, ".cache/sync/backups")), {
    code: "ENOENT",
  });
});
test("concurrent inspections share one read of the connected tavern", async (t) => {
  let releaseInspection;
  let calls = 0;
  const { coordinator, socket } = await fixture(t, {
    "workspace:inspect": async () => {
      calls++;
      if (calls === 1)
        await new Promise((resolve) => {
          releaseInspection = resolve;
        });
      return {
        ok: true,
        environment: { origin: "http://127.0.0.1:8019", user: "test" },
        characters: [{ name: "测试角色", id: "test.png" }],
        worldbooks: ["测试世界书"],
      };
    },
  });
  const first = coordinator.inspect(socket);
  const second = coordinator.inspect(socket);
  assert.equal(calls, 1);
  releaseInspection();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].characters[0].name, "测试角色");
  assert.equal(socket.workspaceInspection, undefined);
  await coordinator.inspect(socket);
  assert.equal(calls, 2);
});

test("full backup is on disk before the receiver may mutate either resource", async (t) => {
  const { run, directory } = await fixture(t, {
    "workspace:apply": async (_, temporaryRoot) => {
      const backups = await fs.readdir(
        path.join(temporaryRoot, ".cache/sync/backups"),
      );
      assert.equal(backups.length, 1);
      const saved = JSON.parse(
        await fs.readFile(
          path.join(temporaryRoot, ".cache/sync/backups", backups[0]),
          "utf8",
        ),
      );
      assert.deepEqual(saved.backup, { original: true });
      return { ok: true, verified: true };
    },
  });
  const job = await run();
  assert.equal(job.state, "succeeded");
  assert.ok((await fs.stat(path.join(directory, job.result.backupPath))).size);
});
test("build errors and tampered artifacts prevent preparation and all host writes", async (t) => {
  const { run, events, directory } = await fixture(
    t,
    {},
    {
      build: async () => {
        throw Object.assign(new Error("YAML行42错误"), {
          code: "BUILD_FAILED",
        });
      },
    },
  );
  const broken = await run({ noBuild: false });
  assert.equal(broken.error.code, "BUILD_FAILED");
  await fs.appendFile(
    path.join(directory, "dist/local/命定之诗与黄昏之歌.json"),
    " ",
  );
  const tampered = await run();
  assert.equal(tampered.error.code, "ARTIFACT_MISMATCH");
  assert.ok(!events.includes("workspace:prepare"));
});
test("receiver failures retain the local backup and rollback details without retrying", async (t) => {
  const { run, events } = await fixture(t, {
    "workspace:apply": async () => ({
      ok: false,
      error: {
        code: "HOST_HTTP",
        message: "写入失败",
        rollback: { ok: false, errors: ["worldbook"] },
      },
    }),
  });
  const job = await run();
  assert.equal(job.state, "failed");
  assert.equal(job.error.rollback.ok, false);
  assert.ok(job.error.backupPath);
  assert.equal(events.filter((event) => event === "workspace:apply").length, 1);
});
test("missing awaited acknowledgement is an uncertain failure with a recovery backup", async (t) => {
  const { run, events } = await fixture(t, {
    "workspace:apply": async () => {
      throw new Error("timeout");
    },
  });
  const job = await run();
  assert.equal(job.error.code, "ACK_TIMEOUT");
  assert.ok(job.error.backupPath);
  assert.equal(events.filter((event) => event === "workspace:apply").length, 1);
});
test("unpublished release profiles are rejected before any host query", async (t) => {
  const { coordinator, events } = await fixture(t);
  assert.throws(() => coordinator.start({ profile: "release" }), {
    code: "UNPUBLISHED",
  });
  assert.equal(events.length, 0);
});
test("HTTP service exposes tools and geography but blocks private files and foreign control origins", async (t) => {
  const { server, sync } = await createWorkspaceServer({ directory: root });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => sync.io.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + "/")).status, 200);
  assert.equal((await fetch(base + "/sync/bridge.mjs")).status, 200);
  assert.equal((await fetch(base + "/sync/http.mjs")).status, 200);
  assert.equal(
    (await fetch(base + "/content/geography/places.yaml")).status,
    200,
  );
  assert.equal((await fetch(base + "/imports/cloud/card.png")).status, 404);
  const rejected = await fetch(base + "/_workspace/jobs", {
    method: "POST",
    headers: {
      Origin: "https://elsewhere.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error.code, "ORIGIN");
});
async function cdnRelease(directory, published) {
  await fs.writeFile(
    path.join(directory, "release.json"),
    JSON.stringify({
      repository: "example/card",
      cardName: "测试卡",
      version: "1.2.3",
      localOrigin: "http://127.0.0.1:5173",
      assets: {
        version: "1.0.1",
        published,
        cdnOrigins: ["https://a.example.net", "https://b.example.net"],
      },
    }),
  );
}
test("CDN pushes stop before any host query when assets are unpublished or missing", async (t) => {
  const probed = [];
  const { directory, events, run, coordinator } = await fixture(
    t,
    {},
    {
      probe: async (roots) => {
        probed.push(roots);
        return { root: undefined, missing: ["automation/index.js"] };
      },
    },
  );
  assert.throws(() => coordinator.start({ assetSource: "elsewhere" }), {
    code: "ASSET_SOURCE",
  });
  await cdnRelease(directory, false);
  let job = await run({ assetSource: "cdn" });
  assert.equal(job.error.code, "ASSETS_UNPUBLISHED");
  assert.equal(probed.length, 0);
  await cdnRelease(directory, true);
  job = await run({ assetSource: "cdn" });
  assert.equal(job.error.code, "CDN_MISSING");
  assert.deepEqual(probed[0], [
    "https://a.example.net/gh/example/card@assets-v1.0.1/dist/release",
    "https://b.example.net/gh/example/card@assets-v1.0.1/dist/release",
  ]);
  assert.deepEqual(events, []);
  const status = await coordinator.status();
  assert.deepEqual(status.assets, {
    version: "1.0.1",
    tag: "assets-v1.0.1",
    published: true,
  });
});
test("CDN pushes build with the CDN source and reject artifacts built for local", async (t) => {
  const builds = [];
  const { directory, run } = await fixture(
    t,
    {},
    {
      probe: async (roots) => ({ root: roots[1], missing: [] }),
      build: async (...args) => builds.push(args),
    },
  );
  await cdnRelease(directory, true);
  let job = await run({ assetSource: "cdn" });
  assert.equal(job.error.code, "ARTIFACT_MISMATCH");
  const reportFile = path.join(directory, "dist/local/report.json");
  const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
  await fs.writeFile(
    reportFile,
    JSON.stringify({ ...report, assetSource: "cdn" }),
  );
  job = await run({ assetSource: "cdn", noBuild: false });
  assert.equal(job.state, "succeeded", JSON.stringify(job.error));
  assert.equal(builds.at(-1)[3], "cdn");
  assert.equal(job.assets.version, "1.0.1");
  assert.match(job.assets.root, /^https:\/\/b\./);
  // 本机资源的推送不受影响，也不会去查 CDN。
  await fs.writeFile(reportFile, JSON.stringify(report));
  job = await run();
  assert.equal(job.state, "succeeded");
  assert.equal(job.assets, undefined);
});
test("sync and build arguments accept the asset source", () => {
  assert.deepEqual(parseSyncArgs(["--assets", "cdn", "--dry-run"]).options, {
    assetSource: "cdn",
    dryRun: true,
  });
});
