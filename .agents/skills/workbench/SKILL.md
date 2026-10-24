---
name: workbench
description: 修改工作台（tools/workbench/），或者改了开局数据、核心数据、地理数据、世界书命名规则、变量结构等工作台要读写的东西时使用。说明工作台各部分读写哪些文件，格式变了要同步改哪里。
---

工作台是开发组和队友（多数不懂代码）日常改数据、推送、发版的入口。双击根目录「打开工作台.cmd」启动，入口是 `tools/workbench/launch.mjs`，服务端是 `tools/workbench/api.mjs`，页面在 `tools/workbench/ui/`（Vue，无构建步骤）。界面文字一律用中文大白话。

## 数据格式变了，要同步改的地方

改了下面左边的东西，必须检查右边；格式不兼容时同步改工作台，不能只改数据或前端。

| 改动 | 工作台里要检查的地方 |
| --- | --- |
| `content/catalogs/` 新增或删除数据文件 | `api.mjs` 的 `CATALOGS`（列表、标签、说明） |
| 开局数据的字段（新字段、改名、改类型、稀有度取值） | `ui/lib.js` 的 `LABELS`、`FIELD_ORDER`、`RARITIES`、`LONG_KEYS`、`FIXED_KEYS`；`ui/value-editor.js`；`api.mjs` 的 `validateCatalog` |
| 每周推荐 `SPECIAL_RECOMMEND_CORES.json`、核心分类 `content/ui/coreClassification.json` 的结构 | `ui/cores-editors.js` |
| 世界书里命定核心的命名规则（`[命定系统]`、作者括号） | `api.mjs` 的 `worldbookCores`，要和 `packages/frontend/src/apps/home/services/CorePage.ts` 的规则一致 |
| 地理数据 `content/geography/` 的字段或规则 | `ui/map-store.js`（读写、检查规则）、`ui/map-view.js`（表单） |
| 变量结构（`packages/game/src/schema/`） | 发版页的变量结构对比自动生效；不兼容旧存档时在 `CHANGELOG.md` 的条目开头加【不兼容】 |
| 角色卡脚本或正则数量、推送覆盖范围 | `tools/sync/receiver.mjs`、`server.mjs` 的数量检查，`ui/sync.js` 推送页的「会被覆盖 / 会保留」说明 |
| 状态栏主题 `theme-presets.ts` 的写法（`const XTheme: Theme = {...}`、颜色键） | `tools/workbench/themes.mjs`、`ui/theme-view.js` 的分组和中文名 |
| 版本号、卡名、世界书名规则 | `tools/lib/version.mjs`、`tools/release.mjs`、`ui/release.js` |
| 程序资源版本、CDN 域名、加载器（`release.json` 的 `assets`） | `tools/lib/resource-loader.mjs`、`tools/assets.mjs`、`tools/sync/server.mjs` 的 CDN 核对、`ui/sync.js` 的资源来源选项；状态栏设置页 `packages/frontend/src/apps/status/pages/settings/ResourceVersionCard.tsx` |

## 验证

- 改了工作台代码：跑 `node --test tests/workbench.test.mjs tests/release.test.mjs`，然后启动工作台，在浏览器里打开改到的页面实际操作一次。
- 保存类功能要确认两点：只改到目标位置，原文件的注释和换行方式保持不变。测试时先备份数据文件，测完还原，或在「修改记录」页撤销。
- 不要在用户正在用的浏览器标签里操作，另开一个标签。
