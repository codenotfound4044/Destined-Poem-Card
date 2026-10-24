# 命定之诗与黄昏之歌

本仓库把角色卡、世界书、前端和自动化放在一起维护。可以直接向智能体描述要改的条目、界面或规则，再由源码生成可导入的角色卡；不需要先填写长篇需求表。

例如：「找到雾晶港的地理设定」「调整自定义开局的装备选项」「检查升级后的生命上限和状态栏是否一致」。先定位源码，讨论必要选择，再修改和检查。

## 工作台（推荐给所有人）

双击根目录的 **`打开工作台.cmd`**，浏览器会打开命定之诗工作台，不需要输入任何命令：

- **开局数据**：编辑自定义开局的背景、装备、道具、技能、伙伴、资产，以及首页的每周推荐和核心分类；支持排序、多选批量修改和分类管理，保存时保留文件里的注释。
- **状态栏主题**：调整状态栏几套配色，实时预览，直接存回源码。
- **地图**：直接在地图上编辑地点、路线和地图标记，左侧有地点树和自动检查出的问题，改错了能撤销。
- **推送到酒馆**：把最新内容写进酒馆里已有的角色卡，自动备份，可一键恢复；封面也在这里换。
- **版本与发布**：对比变量结构、写更新记录、按开发组定的版本号生成发布包。
- **修改记录**：工作台的每次保存都可以撤销。

第一次使用需要先安装 [Node.js](https://nodejs.org/zh-cn/download) 24 或以上（选 LTS）；构建和推送还需要 [Python](https://www.python.org/downloads/) 3.11+（安装时勾选 Add python.exe to PATH）。其余依赖由启动器自动安装。使用期间保持弹出的黑色窗口开着，关掉它工作台就会停止。非 Windows 系统运行 `pnpm workbench`。

## 从这里开始（开发者）

需要 Node.js 24 或以上、pnpm 11.17.0，以及 Python 3.11+ 和 `requirements.txt` 中的 Python 依赖。在仓库根目录运行：

```sh
python -m pip install -r requirements.txt
pnpm setup:workspace
pnpm refs restore
pnpm card map 雾晶港
pnpm card check
pnpm card build
pnpm dev
```

`pnpm dev` 在 `http://127.0.0.1:5173` 提供本机静态资源。页面依赖酒馆助手等宿主 API，直接在普通浏览器打开只能检查可独立运行的部分。把本地构建导入测试酒馆后，才能验证脚本和变量交互。

`setup:workspace` 检查环境并执行冻结锁文件安装。本地产物为 `dist/local/命定之诗与黄昏之歌.json`，同时用 `card/cover/cover.png` 生成 PNG 角色卡；release 产物放在 `dist/release/`，文件名相同。

| 要修改的内容                       | 源码入口                               |
| ---------------------------------- | -------------------------------------- |
| 卡片元数据 | `card/` |
| 三条开场白 | `card/greetings/index.json` 与同目录文本 |
| 脚本与正则顺序 | `card/scripts/index.json`、`card/regex/index.json` 与 `views/` |
| 世界设定、提示词、条目激活条件     | `worldbook/命定之诗.yaml` 与其引用文件 |
| 装备、技能、伙伴、开局及界面数据   | `content/catalogs/`、`content/ui/`     |
| 地点、路线与地图维护工具 | `content/geography/`、`tools/geography/` |
| 状态 Schema、共用资源公式          | `packages/game/src/`                   |
| 首页、自定义开局、状态栏           | `packages/frontend/src/apps/`          |
| Schema 注册、图片预载入            | `packages/frontend/src/scripts/`       |
| 自动化运行逻辑、服务和提示词       | `packages/automation/src/`             |
| 构建目标与维护工具                 | `build/`、`tools/`                     |

数据保留 JSON5 写法；文件名 `.json` 不代表必须去掉注释。`pnpm card map [query]` 先按主题列出源码、消费者、生成物和资料，再全文检索；主题关系保存在 `card/module-map.json`。

## 常用命令

```sh
pnpm card map [query]
pnpm card check
pnpm card build --profile local
pnpm card build --profile release
pnpm card diff
pnpm refs restore
pnpm refs search <query>
pnpm refs check
pnpm refs outdated
pnpm refs refresh
pnpm deps outdated
pnpm deps refresh
pnpm card sync status
pnpm card sync --dry-run
pnpm verify
```

构建默认使用 `local`，自有资源指向本机；`release` 使用配置中的固定 CDN 目标。目标为 `The-poem-of-destiny/Destined-Poem-Card@v<版本>`。版本号、开发版标记、封面和发版流程见 [docs/versioning.md](docs/versioning.md)；当前已发布 V4.3.3，工作区构建标为 `V4.3.3+dev.…`。

推送到酒馆可在工作台中操作，也可用 `pnpm card sync`。在酒馆助手安装一次全局桥接脚本后，可选择已连接的酒馆与目标角色，检查或构建后覆盖同步；首次使用见 [同步到测试酒馆](docs/sync.md)。参考源更新与每周检查 PR 见 [知识源](docs/references.md)，第三方依赖更新见 [依赖维护](docs/dependencies.md)。

进一步说明：[架构与状态边界](docs/architecture.md)、[角色卡契约](docs/contracts.md)、[修改与验证](docs/workflow.md)、[版本、封面与发布](docs/versioning.md)、[地理数据](docs/geography.md)、[世界书树状条目](docs/worldbook-tree.md)、[事件链与事件信号](docs/event-chain.md)、[来源](docs/sources.md)。AI 助手使用的技能在 `.agents/skills/`。

想参与修改或提 PR，请看 [CONTRIBUTING.md](CONTRIBUTING.md)。仓库使用与二创授权见 [LICENSE](LICENSE)。
