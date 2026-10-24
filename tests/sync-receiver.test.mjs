import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createReceiver,
  canonical,
  fingerprint,
  base64ToBytes,
  bytesToBase64,
  stripImageText,
} from "../tools/sync/receiver.mjs";
import { chunk, SIGNATURE } from "../tools/lib/png.mjs";
import { requestHostJSON } from "../tools/sync/http.mjs";

const copy = (value) => structuredClone(value);
const target = { characterName: "测试角色", worldbookName: "测试世界书" };
function fixture() {
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    name: target.characterName,
    avatar: "none",
    chat: "build-chat",
    create_date: "build-date",
    data: {
      name: target.characterName,
      first_mes: "new greeting",
      alternate_greetings: ["second", "third"],
      description: "new description",
      system_prompt: "source system prompt",
      post_history_instructions: "source instruction",
      character_book: {
        name: target.worldbookName,
        entries: [
          { id: 0, keys: ["测试"], content: "完整世界书", enabled: true },
        ],
      },
      extensions: {
        world: target.worldbookName,
        tavern_helper: {
          variables: {
            map_markers: [{ id: "workspace-marker" }],
            map_drawings: [],
          },
          scripts: Array.from({ length: 7 }, (_, index) => ({
            type: "script",
            id: `script-${index}`,
            name: `脚本${index}`,
            enabled: true,
            content: `source ${index}`,
            data: { configured: "source" },
            button: {
              enabled: true,
              buttons: [{ name: "按钮", visible: true }],
            },
            export_with: { data: true, button: true },
          })),
        },
        regex_scripts: Array.from({ length: 10 }, (_, index) => ({
          id: `regex-${index}`,
          scriptName: `正则${index}`,
          findRegex: "/hello/gi",
          replaceString: "world",
          placement: [2],
        })),
      },
    },
  };
  const original = copy(card);
  original.avatar = "installed.png";
  original.chat = "existing-chat";
  original.create_date = "existing-date";
  original.data.description = "old description";
  original.data.system_prompt = "old system prompt";
  original.data.extensions.tavern_helper.variables = {
    map_markers: [{ id: "user-marker" }],
    map_drawings: [{ id: "old-stroke" }],
    theme: "runtime-only",
  };
  original.data.extensions.tavern_helper.scripts[0].data = {
    configured: "runtime old",
    cache: { value: 42 },
  };
  original.data.extensions.tavern_helper.scripts[0].content = "old script";
  original.data.extensions.regex_scripts.push({
    id: "third-party",
    scriptName: "动态管理规则",
    findRegex: "/x/g",
    replaceString: "y",
    placement: [2],
  });
  const state = {
    character: original,
    worldbook: { entries: { 5: { uid: 5, content: "old worldbook" } } },
    characters: [{ name: target.characterName, id: "installed.png" }],
    writes: [],
  };
  const host = {
    environment: async () => ({
      origin: "http://127.0.0.1:8190",
      user: "test-user",
      helperVersion: "4.11.3",
    }),
    listCharacters: async () => copy(state.characters),
    listWorldbooks: async () =>
      state.worldbook === null ? [] : [target.worldbookName],
    readCharacter: async () => copy(state.character),
    readWorldbook: async () => copy(state.worldbook),
    convertWorldbook: async (book) => ({
      entries: Object.fromEntries(
        book.entries.map((entry) => [
          entry.id,
          { uid: entry.id, content: entry.content, key: entry.keys },
        ]),
      ),
      originalData: book,
    }),
    writeCharacter: async (id, value) => {
      assert.equal(id, "installed.png");
      state.writes.push("character");
      state.character = copy(value);
    },
    writeWorldbook: async (name, value) => {
      assert.equal(name, target.worldbookName);
      state.writes.push("worldbook");
      state.worldbook = copy(value);
    },
    deleteWorldbook: async () => {
      state.writes.push("delete-worldbook");
      state.worldbook = null;
    },
    refresh: async () => {
      state.writes.push("refresh");
    },
  };
  const receiver = createReceiver(host);
  const request = { operationId: "operation-1", card, target };
  return {
    card,
    original: copy(original),
    initialWorldbook: copy(state.worldbook),
    state,
    host,
    receiver,
    request,
  };
}
async function plan(f) {
  const result = await f.receiver.prepare(f.request);
  assert.equal(result.ok, true, JSON.stringify(result));
  return {
    ...f.request,
    targetFingerprint: result.targetFingerprint,
    backup: result.backup,
  };
}

test("prepare is read-only; apply preserves identity, runtime-only variables, script runtime data and third-party regex", async () => {
  const f = fixture();
  const request = await plan(f);
  assert.deepEqual(f.state.writes, []);
  assert.deepEqual(request.backup.character.card, f.original);
  assert.equal(typeof request.targetFingerprint, "string");
  const result = await f.receiver.apply(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(f.state.character.avatar, "installed.png");
  assert.equal(f.state.character.chat, "existing-chat");
  assert.equal(f.state.character.create_date, "existing-date");
  assert.equal(f.state.character.data.system_prompt, "source system prompt");
  const settings = f.state.character.data.extensions.tavern_helper;
  // 卡里带的变量以工作区为准，只在酒馆里产生的变量保留。
  assert.deepEqual(settings.variables, {
    map_markers: [{ id: "workspace-marker" }],
    map_drawings: [],
    theme: "runtime-only",
  });
  assert.deepEqual(settings.scripts[0].data, {
    configured: "source",
    cache: { value: 42 },
  });
  assert.deepEqual(
    settings.scripts[0].button,
    f.card.data.extensions.tavern_helper.scripts[0].button,
  );
  assert.equal(settings.scripts[0].id, "script-0");
  assert.equal(f.state.character.data.extensions.regex_scripts.length, 11);
  assert.equal(
    f.state.character.data.extensions.regex_scripts.at(-1).id,
    "third-party",
  );
  assert.equal(f.state.worldbook.entries[0].content, "完整世界书");
});

test("apply waits for the post-write character cache before reporting success", async () => {
  const f = fixture();
  const readList = f.host.listCharacters;
  let cacheRebuilt = false;
  let sawPlaceholder = false;
  let notified = false;
  f.host.listCharacters = () =>
    requestHostJSON(async () => {
      if (f.state.writes.includes("character") && !sawPlaceholder) {
        sawPlaceholder = true;
        return new Response("[]", {
          headers: {
            "x-cocktail-plus-state": "ASYNC-MISS",
            "x-cocktail-plus-retry-after-ms": "100",
          },
        });
      }
      if (sawPlaceholder) cacheRebuilt = true;
      return Response.json(await readList());
    }, "/api/characters/all");
  f.host.notify = (_, type) => {
    assert.equal(type, "success");
    assert.equal(cacheRebuilt, true);
    notified = true;
  };
  const result = await f.receiver.apply(await plan(f));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(sawPlaceholder, true);
  assert.equal(notified, true);
  assert.deepEqual(f.state.writes, ["worldbook", "character", "refresh"]);
});

test("a failed final snapshot never emits a premature success notification", async () => {
  const f = fixture();
  const readList = f.host.listCharacters;
  const notifications = [];
  f.host.listCharacters = async () =>
    f.state.writes.includes("character") ? [] : readList();
  f.host.notify = (_, type) => notifications.push(type);
  const result = await f.receiver.apply(await plan(f));
  assert.equal(result.error.code, "CHARACTER_NOT_FOUND");
  assert.equal(result.error.rollback.ok, true);
  assert.deepEqual(notifications, ["error"]);
  assert.deepEqual(f.state.character, f.original);
});

test("optional [去古风] regex rules are accepted and keep the toggle chosen in the tavern", async () => {
  const f = fixture();
  const optional = (id, disabled) => ({
    id,
    scriptName: `[去古风]规则${id}`,
    disabled,
    findRegex: "/掌柜/g",
    replaceString: "老板",
    placement: [2],
  });
  f.card.data.extensions.regex_scripts.push(
    optional("opt-on", true),
    optional("opt-new", true),
  );
  // 酒馆里已经手动打开过 opt-on；opt-new 是新加的规则。
  f.state.character.data.extensions.regex_scripts.push(
    optional("opt-on", false),
  );
  const result = await f.receiver.apply(await plan(f));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.summary.managedRegex, 12);
  const rules = new Map(
    f.state.character.data.extensions.regex_scripts.map((r) => [r.id, r]),
  );
  assert.equal(rules.get("opt-on").disabled, false);
  assert.equal(rules.get("opt-new").disabled, true);
  assert.equal(rules.get("regex-0").replaceString, "world");
});

test("a card without exactly ten base regex rules is rejected", async () => {
  const f = fixture();
  f.card.data.extensions.regex_scripts.pop();
  const result = await f.receiver.prepare(f.request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_CARD");
});

test("same-name conflicts and absent characters stop before all writes", async () => {
  const f = fixture();
  f.state.characters.push({ name: target.characterName, id: "duplicate.png" });
  assert.equal(
    (await f.receiver.prepare(f.request)).error.code,
    "AMBIGUOUS_CHARACTER",
  );
  f.state.characters = [];
  assert.equal(
    (await f.receiver.prepare(f.request)).error.code,
    "CHARACTER_NOT_FOUND",
  );
  assert.deepEqual(f.state.writes, []);
});

test("the receiver validates source names, managed counts, IDs and regex syntax", async () => {
  for (const mutate of [
    (card) => {
      card.data.name = " ";
    },
    (card) => {
      card.data.alternate_greetings.pop();
    },
    (card) => {
      card.data.extensions.tavern_helper.scripts.pop();
    },
    (card) => {
      card.data.extensions.regex_scripts[1].id = "regex-0";
    },
    (card) => {
      card.data.extensions.regex_scripts[0].findRegex = "/[/g";
    },
  ]) {
    const f = fixture();
    mutate(f.card);
    const result = await f.receiver.prepare(f.request);
    assert.equal(result.ok, false);
    assert.deepEqual(f.state.writes, []);
  }
});

test("bare regex patterns and explicitly named installed targets are valid", async () => {
  const f = fixture();
  f.card.data.name = "命定之诗与黄昏之歌 V4.3.3-workspace.1";
  f.card.name = f.card.data.name;
  f.card.data.extensions.regex_scripts[0].findRegex =
    "<StatusPlaceHolderImpl/>";
  f.card.data.extensions.regex_scripts[1].findRegex = "【首页】";
  f.card.data.extensions.regex_scripts[2].findRegex = "/quoted/gg";
  const request = await plan(f);
  assert.equal((await f.receiver.apply(request)).ok, true);
  assert.equal(f.state.character.name, target.characterName);
  assert.equal(f.state.character.data.name, target.characterName);
  assert.equal(f.state.character.data.extensions.world, target.worldbookName);
  assert.equal(
    f.state.character.data.character_book.name,
    target.worldbookName,
  );
  assert.equal(f.state.character.avatar, "installed.png");
  assert.equal(f.state.character.chat, "existing-chat");
  assert.equal(f.card.data.name, "命定之诗与黄昏之歌 V4.3.3-workspace.1");
});

test("the current built CCv3 card passes prepare for the explicitly selected original card name", async (t) => {
  let card;
  try {
    card = JSON.parse(
      await fs.readFile(
        new URL("../dist/local/命定之诗与黄昏之歌.json", import.meta.url),
        "utf8",
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      return t.skip("运行 local 构建后验证实际产物；裸模式回归始终执行");
    throw error;
  }
  assert.ok(
    card.data.extensions.regex_scripts.some(
      (rule) => !rule.findRegex.startsWith("/"),
    ),
  );
  const f = fixture();
  const installedTarget = {
    characterName: "命定之诗与黄昏之歌v4.3",
    worldbookName: "命定之诗与黄昏之歌v4.3",
  };
  f.state.characters[0].name = installedTarget.characterName;
  f.state.character.name = installedTarget.characterName;
  f.state.character.data.name = installedTarget.characterName;
  const result = await f.receiver.prepare({
    operationId: "actual-build",
    card,
    target: installedTarget,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.summary.scripts, 7);
  assert.equal(result.summary.managedRegex, 10);
  assert.equal(result.summary.greetings, 3);
  assert.deepEqual(f.state.writes, []);
});

test("changing the source or persisted target after backup requires another prepare", async () => {
  const f = fixture();
  const request = await plan(f);
  const changed = copy(request);
  changed.card.data.description = "different build";
  assert.equal(
    (await f.receiver.apply(changed)).error.code,
    "PREPARE_REQUIRED",
  );
  f.state.character.data.description = "user edited meanwhile";
  assert.equal((await f.receiver.apply(request)).error.code, "TARGET_CHANGED");
  assert.deepEqual(f.state.writes, []);
});

test("failure after a partial commit rolls back both resources and verifies them", async () => {
  const f = fixture();
  const request = await plan(f);
  const write = f.host.writeCharacter;
  let first = true;
  f.host.writeCharacter = async (...args) => {
    await write(...args);
    if (first) {
      first = false;
      throw Error("connection lost after commit");
    }
  };
  const result = await f.receiver.apply(request);
  assert.equal(result.ok, false);
  assert.equal(result.error.rollback.ok, true);
  assert.deepEqual(f.state.character, f.original);
  assert.deepEqual(f.state.worldbook, f.initialWorldbook);
});

test("a read-back mismatch cannot be reported as success", async () => {
  const f = fixture();
  const request = await plan(f);
  let first = true;
  f.host.refresh = async () => {
    if (first) {
      first = false;
      f.state.character.data.description = "wrong persisted value";
    }
  };
  const result = await f.receiver.apply(request);
  assert.equal(result.error.code, "VERIFY_FAILED");
  assert.equal(result.error.rollback.ok, true);
  assert.deepEqual(f.state.character, f.original);
});

test("a failed initial worldbook creation is removed during rollback", async () => {
  const f = fixture();
  f.state.worldbook = null;
  const request = await plan(f);
  const write = f.host.writeCharacter;
  let first = true;
  f.host.writeCharacter = async (...args) => {
    if (first) {
      first = false;
      throw Error("write rejected");
    }
    await write(...args);
  };
  const result = await f.receiver.apply(request);
  assert.equal(result.error.rollback.ok, true);
  assert.equal(f.state.worldbook, null);
  assert.ok(f.state.writes.includes("delete-worldbook"));
});

test("rollback attempts the character even if restoring the worldbook fails", async () => {
  const f = fixture();
  const request = await plan(f);
  let writes = 0;
  f.host.writeWorldbook = async () => {
    writes++;
    throw Error("disk full");
  };
  const result = await f.receiver.apply(request);
  assert.equal(writes, 2);
  assert.equal(result.error.rollback.ok, false);
  assert.ok(f.state.writes.includes("character"));
  assert.ok(
    result.error.rollback.errors.some(
      (entry) => entry.resource === "worldbook",
    ),
  );
});

test("explicit restore validates backup ownership and can restore a successful update", async () => {
  const f = fixture();
  const request = await plan(f);
  assert.equal((await f.receiver.apply(request)).ok, true);
  const wrong = copy(request.backup);
  wrong.character.id = "other.png";
  assert.equal(
    (await f.receiver.restore({ backup: wrong, target })).error.code,
    "BACKUP_TARGET_MISMATCH",
  );
  const foreign = copy(request.backup);
  foreign.environment.user = "another-user";
  assert.equal(
    (await f.receiver.restore({ backup: foreign, target })).error.code,
    "BACKUP_TARGET_MISMATCH",
  );
  const result = await f.receiver.restore({ backup: request.backup, target });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(f.state.character, f.original);
  assert.deepEqual(f.state.worldbook, f.initialWorldbook);
});

test("parallel operations cannot race target selection and writes", async () => {
  const f = fixture();
  let release;
  f.host.environment = () =>
    new Promise((resolve) => {
      release = () => resolve({ origin: "local", user: "user" });
    });
  const pending = f.receiver.inspect();
  assert.equal((await f.receiver.prepare(f.request)).error.code, "BUSY");
  release();
  assert.equal((await pending).ok, true);
});

test("canonical fingerprint ignores object key order, but not source array ordering", async () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(
    await fingerprint({ b: 2, a: 1 }),
    await fingerprint({ a: 1, b: 2 }),
  );
  assert.notEqual(await fingerprint([1, 2]), await fingerprint([2, 1]));
});

// 头像：用两张不同的小 PNG 模拟旧头像和新封面；酒馆写入时会重新编码并塞进卡数据（文字块）。
const tinyPNG = (color) => Uint8Array.from(chunkPNG(color));
function chunkPNG(color) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", Buffer.from([color])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function withAvatar(f, { failWrite = false } = {}) {
  f.state.avatar = Buffer.concat([
    tinyPNG(1).subarray(0, -12),
    chunk("tEXt", Buffer.from("chara\0old-card")),
    tinyPNG(1).subarray(-12),
  ]);
  Object.assign(f.host, {
    readAvatar: async () => Uint8Array.from(f.state.avatar),
    writeAvatar: async (id, data) => {
      assert.equal(id, "installed.png");
      f.state.writes.push("avatar");
      if (failWrite) throw new Error("edit-avatar 500");
      const bytes = Buffer.from(base64ToBytes(data));
      f.state.avatar = Buffer.concat([
        bytes.subarray(0, -12),
        chunk("tEXt", Buffer.from("chara\0re-embedded")),
        bytes.subarray(-12),
      ]);
    },
    imageFingerprint: async (data) =>
      createHash("sha256").update(base64ToBytes(data)).digest("hex"),
  });
  f.request.avatar = { data: bytesToBase64(tinyPNG(2)) };
  return f;
}

test("avatar is replaced after the character, compared by image only, and kept in the backup", async () => {
  const f = withAvatar(fixture());
  const request = await plan(f);
  assert.equal(
    Buffer.from(base64ToBytes(request.backup.avatar.data)).includes("old-card"),
    false,
    "备份里的旧头像不带卡数据",
  );
  const result = await f.receiver.apply(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.summary.avatar, "replace");
  assert.deepEqual(f.state.writes.slice(0, 3), [
    "worldbook",
    "character",
    "avatar",
  ]);
  assert.deepEqual(
    Buffer.from(stripImageText(f.state.avatar)),
    Buffer.from(tinyPNG(2)),
  );
  // 再推一次同样的封面：不重复写头像。
  f.state.writes = [];
  const again = await f.receiver.apply(await plan(f));
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.summary.avatar, "unchanged");
  assert.ok(!f.state.writes.includes("avatar"));
  // 用第一次的备份恢复：头像回到旧图。
  const restored = await f.receiver.restore({ backup: request.backup, target });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.deepEqual(
    Buffer.from(stripImageText(f.state.avatar)),
    Buffer.from(tinyPNG(1)),
  );
});

test("a failed avatar write rolls back character and worldbook", async () => {
  const f = withAvatar(fixture(), { failWrite: true });
  const result = await f.receiver.apply(await plan(f));
  assert.equal(result.ok, false);
  assert.equal(canonical(f.state.character), canonical(f.original));
  assert.equal(canonical(f.state.worldbook), canonical(f.initialWorldbook));
});
