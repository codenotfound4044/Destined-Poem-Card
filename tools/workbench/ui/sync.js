import { ref, computed, onMounted, onBeforeUnmount } from "/vendor/vue.js";
import { api, toast } from "./lib.js";

const PHASES = [
  ["remote", "核对 CDN 资源"],
  ["build", "构建角色卡"],
  ["validate", "检查产物"],
  ["prepare", "读取酒馆里的旧内容"],
  ["backup", "保存备份"],
  ["apply", "写入并核对"],
  ["complete", "完成"],
];
const RESTORE_PHASES = [
  ["reading-backup", "读取备份"],
  ["restore", "恢复并核对"],
  ["complete", "完成"],
];
const time = (iso) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "");

export const SyncView = {
  props: { route: { type: Array, default: () => [] } },
  setup() {
    const status = ref(null);
    const statusError = ref("");
    const clientId = ref("");
    const character = ref("");
    const worldbook = ref("");
    const job = ref(null);
    const jobMode = ref("");
    const busy = ref(false);
    const backups = ref([]);
    // 界面资源从哪加载：本机（开发测试，只有这台电脑开着工作台时能显示）或已发布的 CDN。
    const assetSource = ref("local");
    const assets = computed(() => status.value?.assets ?? null);
    const cdnReady = computed(() => assets.value?.published === true);
    let timer;

    const clients = computed(() => status.value?.clients ?? []);
    const client = computed(() => clients.value.find((c) => c.id === clientId.value));
    const characters = computed(() => client.value?.characters ?? []);
    const worldbooks = computed(() => client.value?.worldbooks ?? []);
    const origin = computed(() => status.value?.origin ?? location.origin);
    const importLine = computed(() => `import '${origin.value}/sync/bridge.mjs';`);
    const ready = computed(() => client.value && !client.value.error && character.value && worldbook.value.trim() && !busy.value);
    const jobSource = ref("local");
    const phases = computed(() => (jobMode.value === "restore" ? RESTORE_PHASES : jobSource.value === "cdn" ? PHASES : PHASES.slice(1)));
    const phaseIndex = computed(() => phases.value.findIndex(([key]) => key === job.value?.phase));

    async function refresh() {
      if (busy.value) return;
      try {
        const data = await api("/_workspace/status");
        status.value = data;
        statusError.value = "";
        if (!clients.value.some((c) => c.id === clientId.value)) {
          // 同一个酒馆开了多个标签页时，它们写的是同一份数据，直接选最新连上的那个。
          const places = new Set(clients.value.map((c) => `${c.environment?.origin}|${c.environment?.user}`));
          clientId.value = places.size === 1 ? clients.value.at(-1).id : clients.value.some((c) => c.id === data.defaults?.clientId) ? data.defaults.clientId : "";
        }
        if (!character.value) {
          const preferred = data.defaults?.characterName;
          character.value = characters.value.some((c) => c.name === preferred) ? preferred : characters.value.length === 1 ? characters.value[0].name : "";
        }
        if (!worldbook.value) worldbook.value = data.defaults?.worldbookName ?? "";
        if (assetSource.value === "cdn" && !cdnReady.value) assetSource.value = "local";
      } catch (error) {
        statusError.value = error.message;
      }
    }
    async function loadBackups() {
      try {
        backups.value = (await api("/_workbench/sync-backups")).items;
      } catch {
        backups.value = [];
      }
    }
    function pickCharacter() {
      const found = characters.value.find((c) => c.name === character.value);
      if (found?.worldbook) worldbook.value = found.worldbook;
    }
    async function copyLine() {
      try {
        await navigator.clipboard.writeText(importLine.value);
        toast("已复制，粘贴到酒馆助手的新脚本里", "ok");
      } catch {
        toast("复制失败，请手动选中复制", "error");
      }
    }
    async function follow(started, mode) {
      job.value = started;
      jobMode.value = mode;
      while (job.value.state === "running" || job.value.state === "queued") {
        await new Promise((r) => setTimeout(r, 900));
        job.value = (await api(`/_workspace/jobs/${encodeURIComponent(job.value.id)}`)).job;
      }
    }
    async function start(dryRun) {
      if (!ready.value) return;
      if (!dryRun && !confirm(`确定用工作区的内容覆盖酒馆里的「${character.value}」和世界书「${worldbook.value}」吗？\n\n在酒馆里对这张卡做过的改动都会被覆盖，包括改过的设定和开场白、世界书、头像、地图标记、地图上画的线、自定义开局保存的角色预设。\n聊天记录和游戏进度不受影响。\n\n覆盖前会自动备份，推错了可以一键恢复。`)) return;
      busy.value = true;
      job.value = null;
      jobSource.value = assetSource.value;
      try {
        const data = await api("/_workspace/jobs", { body: { clientId: clientId.value, characterName: character.value, worldbookName: worldbook.value.trim(), profile: "local", assetSource: assetSource.value, dryRun } });
        await follow(data.job, dryRun ? "check" : "sync");
        if (job.value.state === "succeeded") toast(dryRun ? "检查通过，可以推送" : "推送成功", "ok");
      } catch (error) {
        job.value = { state: "failed", error: { message: error.message } };
      } finally {
        busy.value = false;
        loadBackups();
        refresh();
      }
    }
    async function restore(backup) {
      const match = clients.value.find((c) => c.environment?.origin === backup.origin);
      if (!match) return toast(`请先让备份所属的酒馆（${backup.origin}）连接上工作台`, "error", 5000);
      if (!confirm(`把「${backup.target.characterName}」恢复到 ${time(backup.createdAt)} 推送前的样子？`)) return;
      busy.value = true;
      job.value = null;
      try {
        const data = await api("/_workspace/restore", { body: { clientId: match.id, backupPath: backup.path } });
        await follow(data.job, "restore");
        if (job.value.state === "succeeded") toast("已恢复", "ok");
      } catch (error) {
        job.value = { state: "failed", error: { message: error.message } };
      } finally {
        busy.value = false;
        refresh();
      }
    }
    const describeError = (error) => {
      if (!error) return "";
      const details = error.details && typeof error.details === "object" ? JSON.stringify(error.details, null, 2) : error.details;
      return [error.code && `错误编号：${error.code}`, details, error.backupPath && `本次备份：${error.backupPath}`].filter(Boolean).join("\n\n");
    };

    // 没连上时勤快一点等连接；连上后放慢，避免频繁读取酒馆角色列表。
    async function loop() {
      await refresh();
      timer = setTimeout(loop, clients.value.length ? 15000 : 3000);
    }
    onMounted(() => {
      loop();
      loadBackups();
    });
    onBeforeUnmount(() => clearTimeout(timer));

    // 封面：推送时会替换酒馆里这张卡的头像，打包时卡数据也写进这张图。
    const coverStamp = ref(Date.now());
    const coverInfo = ref("");
    function pickCover() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.type && file.type !== "image/png") return toast("封面只能用 PNG 图片", "error", 5000);
        busy.value = true;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const res = await api("/_workbench/cover", { body: { data: btoa(binary) } });
          coverStamp.value = Date.now();
          coverInfo.value = `${res.width}×${res.height}`;
          toast("封面已更换，下次推送和打包生效", "ok", 5000);
        } catch (e) {
          toast(e.message, "error", 6000);
        } finally {
          busy.value = false;
        }
      };
      input.click();
    }
    return { assetSource, assets, cdnReady, coverStamp, coverInfo, pickCover, status, statusError, clientId, character, worldbook, job, jobMode, busy, backups, clients, client, characters, worldbooks, origin, importLine, ready, phases, phaseIndex, refresh, pickCharacter, copyLine, start, restore, describeError, time };
  },
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1>推送到酒馆</h1>
        <p>把工作区里的最新内容直接写进酒馆里已有的角色卡，不用再手动导出、导入。</p>
      </div>
    </div>
    <div v-if="statusError" class="banner error"><div class="grow">{{ statusError }}</div></div>

    <div class="card steps">
      <div class="step" :class="{ done: clients.length }">
        <div class="step-num">{{ clients.length ? '✓' : '1' }}</div>
        <div class="step-body">
          <h2>连接酒馆</h2>
          <template v-if="!clients.length">
            <p class="muted">第一次使用需要在酒馆里装一个小的连接脚本，装一次以后一直有效。</p>
            <ol class="howto">
              <li>在<b>这台电脑</b>的浏览器里打开你的酒馆（SillyTavern），保持页面开着。</li>
              <li>点顶部的「扩展」→「酒馆助手」→「脚本库」，切到「全局脚本」。</li>
              <li>点「导入」，选择下面下载的文件；或者新建一个脚本，把下面那行代码粘贴进去。</li>
              <li>打开这个脚本的开关，回到这里，几秒钟内就会显示「已连接」。</li>
            </ol>
            <div class="row">
              <a class="btn primary" :href="origin + '/sync/install.json'" download>下载连接脚本</a>
              <code class="grow" style="background:var(--surface-2);padding:7px 10px;border-radius:7px;border:1px solid var(--border);overflow:auto;white-space:nowrap">{{ importLine }}</code>
              <button class="btn" @click="copyLine">复制</button>
            </div>
            <p class="muted small">连接脚本只是开发工具，不会被打包进角色卡；不用的时候在酒馆里关掉它的开关就行。</p>
            <div class="row muted small"><span class="spinner"></span>正在等待酒馆连接…</div>
          </template>
          <template v-else>
            <label class="field" style="max-width:520px">
              <span class="field-label">已连接的酒馆</span>
              <select v-model="clientId" :disabled="busy" @change="character = ''; refresh()">
                <option v-if="clients.length > 1" value="">请选择要推送到哪个酒馆页面</option>
                <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.environment?.origin || '酒馆' }}{{ c.environment?.user ? ' · ' + c.environment.user : '' }}</option>
              </select>
            </label>
            <p v-if="clients.length > 1" class="muted small">检测到 {{ clients.length }} 个酒馆页面连着工作台。同一个酒馆开了多个标签页没关系，选哪个都会写进同一个酒馆。</p>
            <p v-if="client?.error" class="banner error"><span class="grow">这个酒馆连接有问题：{{ client.error.message || client.error }}</span></p>
          </template>
        </div>
      </div>

      <div class="step" :class="{ done: ready || job?.state === 'succeeded' }">
        <div class="step-num">2</div>
        <div class="step-body">
          <h2>选择要覆盖的角色卡</h2>
          <div class="banner warn">
            <div class="grow">
              <b>推送会用工作区的内容整张覆盖这张卡，在酒馆里对这张卡做过的改动都会丢失。</b>
              <p style="margin-top:6px">会被覆盖：在酒馆里改过的角色设定和开场白、整本世界书、头像（换成工作区的封面）、七个脚本和十条基础正则、地图标记和地图上画的线、自定义开局保存的角色预设、角色变量「资源版本」。</p>
              <p>会保留：聊天记录、聊天里的变量（游戏进度）、自动正则另外加的规则、脚本自己保存的运行数据，以及状态栏主题这类只在酒馆里产生的设置。</p>
              <p class="small" style="margin-top:4px">覆盖前会自动备份，推错了可以在下方「推送前的备份」里一键恢复。目标卡需要先在酒馆里导入过一次。</p>
            </div>
          </div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
            <label class="field">
              <span class="field-label">角色卡</span>
              <select v-model="character" :disabled="!client || busy" @change="pickCharacter">
                <option value="">{{ characters.length ? '请选择' : '酒馆里还没有角色卡' }}</option>
                <option v-for="c in characters" :key="c.id" :value="c.name">{{ c.name }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">世界书名称</span>
              <input v-model="worldbook" list="wb-names" :disabled="!client || busy" placeholder="选择或输入世界书名称" />
              <datalist id="wb-names"><option v-for="w in worldbooks" :key="w" :value="w"></option></datalist>
            </label>
          </div>
          <p v-if="worldbook && client && !worldbooks.includes(worldbook.trim())" class="field-hint">酒馆里还没有这个名字的世界书，推送时会新建一个。</p>
          <div class="row" style="gap:14px;margin-top:14px;align-items:center">
            <img :src="'/_workbench/cover?t=' + coverStamp" alt="封面" style="width:64px;height:96px;object-fit:cover;border-radius:6px;background:var(--surface-2);border:1px solid var(--border)" />
            <div class="grow">
              <div><b>头像会换成这张封面</b> <span v-if="coverInfo" class="muted small">{{ coverInfo }}</span></div>
              <p class="muted small">文件是 card/cover/cover.png，打包时卡数据也写进这张图。换一张 PNG 就行，旧封面会自动留一份。</p>
            </div>
            <button class="btn" :disabled="busy" @click="pickCover">更换封面</button>
          </div>
        </div>
      </div>

      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h2>推送</h2>
          <div class="field" style="max-width:640px">
            <span class="field-label">界面和脚本从哪里加载</span>
            <label class="choice"><input type="radio" value="local" v-model="assetSource" :disabled="busy" /><span><b>这台电脑（开发测试）</b><br /><span class="muted small">用工作区刚构建的界面，改完马上能看到。只有在这台电脑上、工作台开着时才能正常显示，手机或别的设备上会加载不出来。</span></span></label>
            <label class="choice"><input type="radio" value="cdn" v-model="assetSource" :disabled="busy || !cdnReady" /><span><b>已发布的程序资源（CDN）<template v-if="assets?.version"> · 版本 {{ assets.version }}</template></b><br /><span class="muted small" v-if="cdnReady">从 CDN 加载已发布的界面，手机和别的设备也能用。推送前会先确认 CDN 上真的有这个版本的文件。玩家可以在角色变量「资源版本」里换版本。</span><span class="muted small" v-else-if="assets?.error">资源版本配置有问题：{{ assets.error }}</span><span class="muted small" v-else>资源版本 {{ assets?.version }} 还没有发布。发布标签 {{ assets?.tag }} 并运行 <code>pnpm card assets verify</code> 核对后才能选。</span></span></label>
          </div>
          <p class="muted">建议先点「先检查」：会构建并核对目标，但不写入酒馆。</p>
          <div class="row">
            <button class="btn" :disabled="!ready" @click="start(true)">先检查（不写入）</button>
            <button class="btn primary" :disabled="!ready" @click="start(false)">推送到酒馆</button>
          </div>
          <template v-if="job">
            <div v-if="job.id" class="progress">
              <span v-for="([key, name], i) in phases" :key="key" :class="{ on: i === phaseIndex && job.state === 'running', ok: i < phaseIndex || job.state === 'succeeded' }">{{ name }}</span>
            </div>
            <div v-if="job.state === 'running'" class="row muted"><span class="spinner"></span>正在进行，构建大约需要半分钟…</div>
            <div v-else-if="job.state === 'succeeded'" class="banner ok">
              <div class="grow">
                <b>{{ jobMode === 'check' ? '检查通过，没有写入酒馆。' : jobMode === 'restore' ? '已恢复到备份时的样子。' : '推送成功！' }}</b>
                <p v-if="job.assets" class="small muted">界面资源：CDN 版本 {{ job.assets.version }}（{{ job.assets.root }}）</p>
                <p v-if="jobMode === 'sync'">刷新酒馆页面后就能看到新内容。如果效果不对，可以在下方「推送前的备份」里一键恢复。</p>
                <p v-if="job.result?.summary" class="small muted">世界书 {{ job.result.summary.worldbookEntries }} 条 · 开场白 {{ job.result.summary.greetings }} 条 · 脚本 {{ job.result.summary.scripts }} 个 · 正则 {{ job.result.summary.managedRegex }} 条{{ job.result.summary.worldbookCreated ? ' · 新建了世界书' : '' }}{{ { replace: ' · 头像换成封面', unchanged: ' · 头像已是当前封面' }[job.result.summary.avatar] ?? '' }}</p>
              </div>
            </div>
            <div v-else-if="job.state === 'failed'" class="banner error">
              <div class="grow">
                <b>没有成功：{{ job.error?.message }}</b>
                <p v-if="job.error?.rollback" class="small">{{ job.error.rollback.ok ? '已经自动撤回到推送前的样子。' : '自动撤回没有完全成功，请用下方的备份恢复。' }}</p>
                <details v-if="describeError(job.error) || job.id"><summary>技术细节（反馈问题时可以复制给开发者）</summary>
                  <pre class="output">{{ describeError(job.error) }}</pre>
                  <a v-if="job.id" :href="'/_workspace/jobs/' + job.id + '/log'" target="_blank">查看完整构建日志</a>
                </details>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <section class="card">
      <div class="card-head"><h2>推送前的备份</h2><span class="muted small">每次推送前自动保存，最多显示最近 20 份</span></div>
      <div v-if="!backups.length" class="muted">还没有备份。</div>
      <div v-else class="list">
        <div v-for="b in backups" :key="b.path" class="list-item">
          <div class="grow">
            <div><b>{{ b.target?.characterName }}</b></div>
            <div class="muted small">{{ time(b.createdAt) }} · {{ b.origin }}{{ b.user ? ' · ' + b.user : '' }}</div>
          </div>
          <button class="btn small" :disabled="busy" @click="restore(b)">恢复</button>
        </div>
      </div>
    </section>
  </div>`,
};
