# 项目协作

这是「命定之诗与黄昏之歌」的统一源码仓库。先读 [README.md](README.md)，按任务加载 `.agents/skills/` 中对应技能；不要把所有资料一次读入。

- 角色卡结构在 `card/`；开场白、脚本和正则分别由 `card/greetings/index.json`、`card/scripts/index.json`、`card/regex/index.json` 定义。世界书入口为 `worldbook/命定之诗.yaml`，可编辑数据在 `content/`，共享状态定义与公式在 `packages/game/`，界面与脚本在 `packages/frontend/`，自动化在 `packages/automation/`。构建配置和工具分别在 `build/`、`tools/`。
- 世界书保留 tavern_sync YAML 与条目文件格式。用 `pnpm card map [query]` 和实际目录树定位条目，不重建手工维护的世界书 Markdown 全览。
- 编写或修改模型提示词（含世界书、开场白与注入文案）时，按 [prompt-style](.agents/skills/prompt-style/SKILL.md) 审校文风与冗余。
- Schema 以 `packages/game/src/schema/` 为唯一来源；共用资源公式放在 `packages/game/src/rules/`。修改前检查前端与自动化调用方，避免复制定义。
- 数据文件即使扩展名是 `.json` 也可能使用 JSON5；按现有解析方式维护，不批量转成严格 JSON。
- 宿主行为查锁定的参考源，按需使用 `pnpm refs restore/search/check/outdated/refresh/update`。更新参考版本需有任务依据，不把最新上游接口直接混入现有环境。
- 地理源数据在 `content/geography/`，脚本与编辑器在 `tools/geography/`。地理图谱变量 `runtime_geo_compact_data` 属于 **chat**；前端地图 `map_markers`、`map_drawings` 属于 **character**。两条链路见 [docs/geography.md](docs/geography.md)。
- `imports/` 不进 Git，只在部分开发组成员本机存在，放原仓库副本、Git bundle 和旧发布卡原件，不是可编辑源码。`IndependentFront` 不属于当前产品。旧仓历史来源见 [docs/sources.md](docs/sources.md)。
- 生成物由构建命令生成，不直接修补。按改动范围选检查（见 [修改与验证](docs/workflow.md)），`pnpm verify` 留给构建/Schema 改动和推送发布前。静态检查、构建通过和酒馆内实际运行分别报告。
- 推送会整张覆盖目标酒馆里的卡，只推到用户指定的酒馆，见 [docs/sync.md](docs/sync.md)。不得把没执行的酒馆实测或模型生成说成已通过。已发布旧版本的 tag 和 CDN 链接不改写；不实现旧存档迁移，除非另有明确需求。
- 仓库许可见 [LICENSE](LICENSE)，外部依赖遵循各自许可。创建远端仓库、发布、打 tag 和推送 Git 都要用户在当前任务里明确同意。
- 版本号、卡名和世界书名只在开发组明确要发布、并给出版本号时才改（`pnpm card release <版本号>`）；平时改变量、改世界观都不动它们。程序资源版本（`release.json` 的 `assets.version`，`pnpm card assets set`）、第三方依赖版本和各包 `package.json` 的版本同样只在开发组明确要求时才改；改了前端或脚本只在 `CHANGELOG.md`「未发布」下记一条。版本习惯和变量结构对比只用于给建议，见 [docs/versioning.md](docs/versioning.md)。
- 工作台（`tools/workbench/`）直接读写开局数据、核心数据、地理数据、世界书核心名和变量结构对比。改了这些数据的格式、世界书的命名规则或变量结构时，要同步改工作台，对照表见 `.agents/skills/workbench/SKILL.md`；不兼容旧存档的改动在 `CHANGELOG.md` 记【不兼容】。
- 提交信息和 PR 说明默认用中文，写法见 `.agents/skills/git-submit/SKILL.md`；外部贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
