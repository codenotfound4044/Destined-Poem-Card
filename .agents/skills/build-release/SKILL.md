---
name: build-release
description: 构建、检查或准备发布命定之诗角色卡与静态资源时使用，核对 profile、装配契约、依赖版本及本地和远端边界。
---

先读 [角色卡契约](../../../docs/contracts.md) 和 [修改与验证](../../../docs/workflow.md)。装配入口是 `card/greetings/index.json`、`card/scripts/index.json`、`card/regex/index.json`（模板在 `views/`）。构建配置在 `build/`，统一命令在 `tools/`，导出卡不直接编辑。

运行 `pnpm card check`、`pnpm card build --profile local`、`pnpm card diff` 和 `pnpm verify`。发布准备再用 `--profile release`，检查自有资源目标、外部固定版本、三条开场白、七个脚本和十条正则的装配结果。

版本号与发版用 `pnpm card version` / `pnpm card release <patch|minor|major>`，规则见 [docs/versioning.md](../../../docs/versioning.md)。程序资源的 CDN 目标为 `https://cdn.poem-of-destiny.com/assets/<资源版本>`（R2 桶 `destiny-assets`），资源版本在 `release.json` 的 `assets`，与卡版本分开；卡内正则和自有脚本走统一加载器（`tools/lib/resource-loader.mjs`），规则见 [程序资源版本](../../../docs/versioning.md#程序资源版本)。资源补丁用 `pnpm card assets set|verify`；构建配置不证明该 tag/CDN 已可访问，`verify` 核对通过才标记发布。旧版本、旧 tag 与旧 CDN 保留原身份，不把所有历史引用批量替换。

资源由 `.github/workflows/publish-assets.yml` 在推送 `assets-v*` 标签时构建并上传 R2，`dist/` 不提交进 Git；同一版本目录已有 `manifest.json` 就拒绝覆盖。工作流需要仓库 Secrets `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。打标签、推送需开发组同意；上传后核对入口 URL 和酒馆加载。

推送到酒馆用 `pnpm card sync` 或工作台的「推送到酒馆」页；先检查目标与覆盖范围，具体命令、备份与恢复见 [推送到酒馆](../../../docs/sync.md)。

实际发布须在当前任务已授权范围内执行；本地构建不隐含创建远端、tag、推送或上传授权。许可见根目录 [LICENSE](../../../LICENSE)。区分静态检查、构建、测试酒馆与真实模型生成结果，未执行项明确列出。
