# 修改与验证

先根据问题定位源码。`pnpm card map <query>` 根据 `card/module-map.json` 先列主题的源码、消费者、生成物和资料，再全文检索。开场白读 `card/greetings/`，脚本读 `card/scripts/index.json`，正则读 `card/regex/index.json` 与 `views/`。世界书命中后继续读 YAML 条目配置和实际文件；界面或规则问题直接查对应 package。旧 Markdown 世界书全览不再是入口，不新增第二套人工索引。

修改数据时保留现有 JSON5 语法和字段约定。若新增运行时数据资源，同步检查 `content/manifest.json` 与消费方。协议内容版本影响首页的同意状态，修改协议时检查现有版本逻辑。

修改宿主集成前，通过 `pnpm refs search <query>` 查锁定资料；缺缓存时先 `pnpm refs restore`。`pnpm refs check` 用于检查参考资料状态；`pnpm refs outdated` 检查上游差异，`pnpm refs refresh` 刷新参考资料，命令范围与每周 PR 见 [知识源](references.md)；`pnpm refs update` 是有意更新参考基线的操作，应按任务需要使用。

初次准备运行 `pnpm setup:workspace`，检查环境并以 frozen lockfile 安装依赖；参考缓存另用 `pnpm refs restore` 恢复。Python 依赖见根目录 `requirements.txt`。

运行 `pnpm card check` 检查装配输入，`pnpm card build` 生成 `dist/local/命定之诗与黄昏之歌.json`，`pnpm card diff` 对照 `card/baseline.json` 中记录的 V4.3.3 发布卡结构与内容哈希摘要。`--profile release` 输出到 `dist/release/`，保持相同文件名。卡片构建同时生成地理资源和 Schema 导出。

检查按改动范围选，不必每次全跑：只改世界书正文或内容数据时跑 `pnpm card check`；改代码时跑相应包的测试和类型检查；改动构建、共享 Schema，或准备推送、发布时才跑 `pnpm verify`。酒馆内实测只在改宿主集成或界面时做，且只测改到的部分。不为日常改动单独写验收报告。verify 汇总九项：测试、类型、Vue、EJS、卡片输入、参考资料、local 构建、release 构建和产物校验；日志位于 `.cache/verification/*.log`，机器可读记录为 `.cache/verification/static.json`。依赖安装由 setup 单独完成，忽略的参考缓存先用 `pnpm refs restore` 恢复。不要把生成文件中的补丁当作源码修复。

通过 `pnpm dev`（或工作台启动器）提供本机资源与工作台，在测试酒馆安装全局连接脚本后，先运行 `pnpm card sync --dry-run`，再运行 `pnpm card sync` 构建并覆盖推送。也可在工作台执行相同操作；目标选择、覆盖范围和恢复见 [推送到酒馆](sync.md)。汇报结果时分别说明：源码/静态检查、构建、酒馆内界面与脚本、模型真实生成；没有执行的层级明确写未验证。

版本号、更新记录和发版命令见 [版本、封面与发布](versioning.md)。发布配置与发布动作分开处理。`release` 构建只生成固定 CDN 目标引用；创建仓库、提交、tag、推送和上传产物需要开发组明确同意。

当前 CDN 路径使用 GitHub 仓库文件，程序资源的标签是 `assets-v<资源版本>`（见 [程序资源版本](versioning.md#程序资源版本)）：目标 tag 对应的提交必须实际包含 `dist/release/**`，只有 GitHub Release 附件不能提供这些 URL。`dist/` 默认忽略；正式发布时显式加入该目录，并保留来源提交记录，勿连同 `imports/` 或运行缓存发布。推送后逐项检查报告中的自有 URL、ESM MIME/CORS 和酒馆加载，再记录实际发布结果；不移动旧 tag。
