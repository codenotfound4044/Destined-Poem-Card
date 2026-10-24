# 角色卡与宿主契约

卡名、世界书名和版本号由 `release.json` 派生（见 [版本、封面与发布](versioning.md)），以结构化源码装配，不直接修改导出 JSON。

三条开场白由 `card/greetings/index.json` 按顺序装配：

1. `first_mes` 来自 `card/greetings/home.txt`，内容为 `【首页】`。
2. 第一条候选开场白来自 `card/greetings/customized.txt`，内容为 `<customized>自定义开局开始</customized>`。
3. 第二条候选开场白来自 `card/greetings/线与天堂与彼岸花.txt`。

`card/scripts/index.json` 定义七个脚本的装配顺序：Schema 注册、MVU、自动化、工坊、自动正则、地理数据、角色库。十条正则按 `card/regex/index.json` 中的有序定义装配，独立替换模板位于 `card/regex/views/`；调整某条规则时同时检查触发范围、阶段、捕获组和替换产物，不仅检查模式能否编译。

MVU 保留上游 beta 无版本浮动链接；`v0.196.0` 是锁定 API 与已测试基线，不代表运行链接固定到该版本。其余第三方外链依赖通过 [依赖维护](dependencies.md) 跟踪和更新，不把参考资料刷新当成宿主或运行依赖升级。

自有代码支持本机和 CDN 两种资源来源：`local` 构建默认用本机，也可以 `--assets cdn`；`release` 构建只用 CDN。CDN 目标为 `The-poem-of-destiny/Destined-Poem-Card@assets-v<资源版本>`，资源版本记在 `release.json` 的 `assets`，与卡版本分开；`published: false` 表示卡的正式发布还没完成，`assets.published` 表示该资源版本已在 CDN 核对过。三条界面正则，Schema、自动化、地理三个自有脚本，以及创意工坊、自动正则、角色管理库三个第三方脚本由统一加载器载入，按顺序回退 CDN 域名，并读取角色变量「资源版本」里各自的一项，见 [程序资源版本](versioning.md#程序资源版本)。卡片输出分别为 `dist/local/命定之诗与黄昏之歌.json` 和 `dist/release/命定之诗与黄昏之歌.json`。旧版本卡片、tag 与 CDN 地址保持其原身份。

地理 loader 和地图默认标记来自同一次地理构建，产物集中到 `dist/<profile>/geography/`，版本由 compact 内容 SHA 生成。JSON Schema 从 `packages/game/` 派生，经前端 `.cache/schema.json` 导出至 `dist/<profile>/frontend/data_schema/schema.json`，不维护第二份 Schema 源。

项目锁定的宿主版本为 SillyTavern `1.19.0`、酒馆助手 `4.11.3`、EJS `1.17.9`。核对宿主能力时先检索锁定资料，再看实际调用。本机检查和构建通过不等于酒馆内已运行或模型生成已通过。

推送将当前构建中的角色卡资源覆盖到指定目标；保留内容、备份和恢复入口见 [推送到酒馆](sync.md)。推送成功和真实模型生成分别验证。

状态修改以当前 Schema 为准，不提供自动的旧存档迁移；不兼容旧存档的改动按 [版本规则](versioning.md) 升版本并在更新记录里注明。地理图谱与地图标记具有不同作用域，见 [geography.md](geography.md)。
