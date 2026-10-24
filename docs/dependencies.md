# 第三方分发依赖

角色卡运行时加载的第三方脚本由 `release.json.dependencies` 指定，来源、角色分组、正式 tag 规则和分发路径由 `maintenance/dependency-sources.json` 声明。它们与 `maintenance/references.lock.json` 的宿主/API 资料基线分别维护。

| 角色                    | 仓库与路径                                                                                       | 策略                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `mvu`                   | `MagicalAstrogy/MagVarUpdate` 的 `artifact/bundle.js`                                            | beta 跟随仓库默认分支，URL 不带 `@`；`version` 标记为 `default-branch`，工具不为它选择 tag 或写入 commit/SHA 锁。 |
| `mvuZod`                | `StageDog/tavern_resource` 的 `dist/util/mvu_zod.js`                                             | `vX.Y.Z` 正式 tag，当前基线 `v0.3.459`。                                                                          |
| `workshop`、`autoRegex` | `Akabanesaki/myrepo` 的 `dist/CreativeWorkshop/index.js`、`dist/AutoDialogueBeautifier/index.js` | 同组 `X.Y.Z` 正式 tag，当前基线 `2.3.1`，两个角色一起更新。                                                       |
| `characterManager`      | `uikawinwing/CharInfo-Manager` 的 `dist/char_info_viewer_runtime/index.js`                       | `vX.Y.Z` 正式 tag，当前基线 `v0.3.7`。                                                                            |

`workshop`、`autoRegex`、`characterManager` 在卡里由统一加载器载入：这里的链接决定卡内默认版本（写进角色变量「资源版本」的「创意工坊」「自动正则」「角色管理库」），玩家可以在状态栏设置页分别改成别的版本，CDN 连不上时自动换域名，见 [程序资源版本](versioning.md#程序资源版本)。因此这三个链接必须保持 jsDelivr 的 `gh/仓库@版本/路径` 形式，构建会检查。

MVU beta 的运行链接是 `https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js`。CDN 可能缓存默认分支文件，因此报告中的默认分支提交只表示检查时的 Git 快照，下载 SHA 表示当次实际收到的脚本，不能把二者当成严格绑定。代码查阅仍使用已验证宿主环境对应的固定 API 参考资料；浮动链接不代表云宿主或其他插件已升级。

```sh
pnpm deps check
pnpm deps outdated --report .cache/dependency-update-report.md
pnpm deps refresh --report maintenance/dependency-update-report.md
```

`check` 检查配置角色、同组版本一致性和 URL，下载当前分发脚本并记录 SHA256/字节数。固定脚本还与 tag 对应 Git 提交的同路径文件比较；已经记录的 SHA 或 commit 出现漂移会报错。它不修改任何版本。

`outdated` 完整分页读取仓库 tags/releases，按数字比较正式语义版本，排除预发布、draft 和不匹配产品规则的 tag。命名如 `v0.3.4-dev2`、`v0.3.2-charlib-...` 或其他产品名称不会成为候选。当前产品规则只接受完整 `vX.Y.Z` 或 `X.Y.Z`，不使用仓库默认分支充当固定依赖新版。候选必须包含配置中的全部分发文件；最新匹配 tag 缺文件会明确报错，不偷偷回退成“已经最新”。

`refresh` 先检查所有来源，验证候选分发文件可下载、非空、不是 HTML/二进制，且 CDN 与 Git 提交字节一致，再一次性写入 `release.json`。固定依赖更新时同时记录 `commit` 和 `sha256`；工坊两个脚本以同一个 tag 更新，任一失败不会写入一半配置。检查期间 release 文件发生其他修改会中止，避免覆盖同时进行的工作。外部校验回调失败则恢复原始文件。普通配置、下载或 API 失败均返回非零，JSON 错误指出具体来源和原因。

MVU 只检查当前默认分支和无版本链接；`outdated`/`refresh` 均不把它锁到任何 tag，不因为 beta 上游移动就改写 `release.json`。报告不含检查时间；SHA 与字节数提供真实分发文件证据。脚本下载后仅做字节校验，不导入执行。检查脚本下载成功与实际酒馆内插件功能正常分别验证。

## 每周审查工作流

`.github/workflows/dependency-update.yml` 每周一 02:43 UTC（北京时间 10:43）运行，支持默认分支手动触发。手动关闭 `refresh` 时只输出 Summary/artifact；开启时仅在固定依赖有新正式版本时生成候选，直接运行完整 `pnpm verify`，然后创建或更新专用 `bot/dependency-update` 分支的草稿 PR。报告随 PR 保存到 `maintenance/dependency-update-report.md`，包含版本、分发 URL、Git 提交、SHA256 与比较链接。

没有固定依赖更新时不创建 PR；同一候选的 release 内容相同时不重复提交，因此 MVU 浮动脚本变化或报告时间不会单独制造更新 PR。专用分支由工作流以 `--force-with-lease` 维护，请勿在该分支手动提交。工作流只提出审查候选，不自动合并、不创建产品 release/tag、不修改宿主版本或云环境。Bot token 创建的 PR 不保证触发其他 workflow，所以本流程在推送前直接执行完整验证。

部署前提与[参考资料工作流](references.md)相同：需要远端默认分支启用 Actions，并允许 `GITHUB_TOKEN` 创建 PR。工作流运行失败会保留 JSON、报告及验证日志作为 artifact。

接口依据：[GitHub releases API](https://docs.github.com/en/rest/releases/releases)、[GitHub tags API](https://docs.github.com/en/rest/repos/repos#list-repository-tags)、[GitHub commits API](https://docs.github.com/en/rest/commits/commits)、[gh pr create](https://cli.github.com/manual/gh_pr_create)。
