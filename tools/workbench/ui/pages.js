import { ref, onMounted } from "/vendor/vue.js";
import { api, toast } from "./lib.js";

const time = (iso) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "");

export const OverviewView = {
  props: { route: { type: Array, default: () => [] } },
  setup() {
    const data = ref(null);
    const error = ref("");
    const running = ref("");
    const result = ref(null);
    async function load() {
      error.value = "";
      try {
        data.value = await api("/_workbench/overview");
      } catch (e) {
        error.value = e.message;
      }
    }
    async function run(name) {
      running.value = name;
      result.value = null;
      try {
        const r = await api("/_workbench/tasks", { body: { name } });
        result.value = { name, ...r };
        toast(r.ok ? (name === "build" ? "构建完成" : "检查通过") : name === "build" ? "构建失败" : "检查发现问题", r.ok ? "ok" : "error");
        await load();
      } catch (e) {
        result.value = { name, ok: false, output: e.message };
      } finally {
        running.value = "";
      }
    }
    onMounted(load);
    return { data, error, running, result, run, time };
  },
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ data?.card.name ?? '命定之诗工作台' }}</h1>
        <p v-if="data">已发布 {{ data.card.version }} · 世界书「{{ data.card.worldbook }}」 · <a href="#/release">版本与发布 →</a></p>
        <p v-else>正在读取工作区…</p>
      </div>
      <div class="row">
        <button class="btn" :disabled="!!running" @click="run('check')"><span v-if="running === 'check'" class="spinner"></span>检查内容</button>
        <button class="btn primary" :disabled="!!running" @click="run('build')"><span v-if="running === 'build'" class="spinner"></span>{{ running === 'build' ? '正在构建…' : '构建角色卡' }}</button>
      </div>
    </div>

    <div v-if="error" class="banner error"><div class="grow">{{ error }}</div></div>

    <div v-if="result" class="banner" :class="result.ok ? 'ok' : 'error'">
      <div class="grow">
        <b>{{ result.name === 'build' ? (result.ok ? '构建完成。' : '构建失败。') : (result.ok ? '内容检查通过。' : '内容检查发现问题。') }}</b>
        <span v-if="result.ms" class="muted small">（用时 {{ (result.ms / 1000).toFixed(1) }} 秒）</span>
        <p v-if="result.ok && result.name === 'build'">新的角色卡在 <code>dist/local/</code>，也可以直接去「推送到酒馆」。</p>
        <details v-if="result.output" :open="!result.ok"><summary>详细输出</summary><pre class="output">{{ result.output }}</pre></details>
      </div>
    </div>

    <template v-if="data">
      <div v-if="!data.check.ok" class="banner error">
        <div class="grow"><b>内容检查没有通过</b>，构建和推送都会失败。把下面的信息发给开发者，或者让 AI 助手看一下。
          <pre class="output">{{ data.check.output }}</pre>
        </div>
      </div>
      <div v-else-if="!data.build" class="banner warn"><div class="grow"><b>还没有构建过角色卡。</b> 点右上角「构建角色卡」，或者直接去推送（推送会自动构建）。</div></div>
      <div v-else-if="data.build.stale" class="banner info"><div class="grow"><b>有修改还没构建。</b> 上次构建于 {{ time(data.build.time) }}。推送到酒馆时会自动构建；也可以现在构建一次，看看有没有问题。</div></div>
      <div v-else class="banner ok"><div class="grow"><b>一切就绪。</b> 上次构建于 {{ time(data.build.time) }}，之后没有新的修改。</div></div>

      <div v-if="data.check.stats" class="grid grid-4">
        <div class="card stat"><span class="stat-value">{{ data.check.stats.entries }}</span><span class="stat-label">世界书条目（{{ data.check.stats.enabled }} 条启用）</span></div>
        <div class="card stat"><span class="stat-value">{{ data.check.stats.scripts }}</span><span class="stat-label">脚本</span></div>
        <div class="card stat"><span class="stat-value">{{ data.check.stats.regex }}</span><span class="stat-label">正则</span></div>
        <div class="card stat"><span class="stat-value">{{ data.geography.places }}</span><span class="stat-label">地图地点（{{ data.geography.edges }} 条路线）</span></div>
      </div>

      <div class="grid grid-3">
        <a class="card link-card" href="#/catalogs"><h2>开局数据</h2><p class="muted">修改自定义开局里的背景、装备、道具、技能、伙伴和资产。</p><span class="arrow">去编辑 →</span></a>
        <a class="card link-card" href="#/map"><h2>地图</h2><p class="muted">编辑地点树、路线和地图标记，保存后直接写回工作区。</p><span class="arrow">打开地图 →</span></a>
        <a class="card link-card" href="#/sync"><h2>推送到酒馆</h2><p class="muted">把最新内容直接写进酒馆里的角色卡，自动备份，可一键恢复。</p><span class="arrow">去推送 →</span></a>
      </div>

      <section v-if="data.check.stats?.unregistered?.length" class="card">
        <details>
          <summary><b style="color:var(--text)">{{ data.check.stats.unregistered.length }} 个世界书文件没有接入角色卡</b></summary>
          <p class="muted small" style="margin:8px 0">这些文件放在世界书文件夹里，但没有登记进世界书主清单，所以不会出现在角色卡中。这是原来就有的状态，不影响使用；需要启用时请告诉开发者。</p>
          <pre class="output">{{ data.check.stats.unregistered.join('\\n') }}</pre>
        </details>
      </section>

      <section v-if="data.check.stats?.nesting?.length" class="card">
        <details>
          <summary><b style="color:var(--text)">{{ data.check.stats.nesting.length }} 处世界书条目可能挂错上级</b></summary>
          <p class="muted small" style="margin:8px 0">这些条目的正文靠缩进接在上一条下面，但顺序号或黏性和上级对不上，同时触发时可能被拼到别的地点下面。不影响角色卡构建；修改方法见 docs/worldbook-tree.md。</p>
          <pre class="output">{{ data.check.stats.nesting.join('\\n') }}</pre>
        </details>
      </section>
    </template>
  </div>`,
};

export const HistoryView = {
  props: { route: { type: Array, default: () => [] } },
  setup() {
    const items = ref([]);
    const error = ref("");
    const busy = ref(false);
    async function load() {
      try {
        items.value = (await api("/_workbench/history")).items;
      } catch (e) {
        error.value = e.message;
      }
    }
    async function undo(item) {
      if (!confirm(`把 ${item.file} 恢复到「${item.summary}」之前的样子？\n\n这之后对这个文件做的修改也会一起撤回（恢复本身也会记录，可以再撤销）。`)) return;
      busy.value = true;
      try {
        await api("/_workbench/history/undo", { body: { id: item.id } });
        toast("已恢复", "ok");
        await load();
      } catch (e) {
        toast(e.message, "error", 6000);
      } finally {
        busy.value = false;
      }
    }
    onMounted(load);
    return { items, error, busy, undo, time };
  },
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h1>修改记录</h1>
        <p>工作台每次保存开局数据或地图前，都会先留一份旧文件。改错了可以在这里恢复，最多显示最近 50 条。</p>
      </div>
    </div>
    <div v-if="error" class="banner error"><div class="grow">{{ error }}</div></div>
    <section class="card">
      <div v-if="!items.length" class="muted">还没有修改记录。</div>
      <div v-else class="list">
        <div v-for="item in items" :key="item.id" class="list-item">
          <div class="grow">
            <div><b>{{ item.summary }}</b></div>
            <div class="muted small">{{ time(item.time) }} · {{ item.file }}</div>
          </div>
          <button class="btn small" :disabled="busy" @click="undo(item)">恢复到这次之前</button>
        </div>
      </div>
    </section>
  </div>`,
};
