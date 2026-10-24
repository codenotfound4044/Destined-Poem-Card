---
name: worldbook
description: 修改命定之诗世界书条目、激活条件、提示词或地理设定时使用；保持 tavern_sync YAML 与实际条目文件一致。
---

从根目录运行 `pnpm card map <关键词>`，再读取 `worldbook/命定之诗.yaml` 对应配置与引用文件。旧 Markdown 全览已退役；不要另建需要人工同步的条目索引。

修改条目时一起核对名称、启用状态、激活策略、插入位置、顺序、递归及文件引用；未涉及的配置保持原状。新增文件必须接入 YAML，不能只把文本放入目录。

涉及 EJS、变量、宏或世界书接口时，按需执行 `pnpm refs search <关键词> --source prompt-template`、`--source sillytavern` 或 `--source tavern-sync`，缺缓存先 `pnpm refs restore`。锁定资料入口见 [知识源](../../../docs/references.md)。

新增或拆分势力、城市、区位条目，或调整势力区块内的顺序、关键词、黏性前，先读 [世界书树状条目](../../../docs/worldbook-tree.md)：当前地点靠自动化注入进入扫描，子条目靠缩进和顺序挂到父条目下，名称、次关键词和号段必须和父条目对得上，子条目黏性不超过父条目；已有黏性是作者设计，改之前先确认。

写或改 `worldbook/命定之诗/事件/` 下的剧情事件、事件阶段或事件信号时，改用 [event-chain](../event-chain/SKILL.md)。

地理源文件在 `content/geography/`，维护脚本与编辑器在 `tools/geography/`；开场白在 `card/greetings/`，不再放入世界书 misc。地理改动先读 [地理流程](../../../docs/geography.md)，区分 chat 图谱和 character 地图。状态字段变动同时检查 `packages/game/src/schema/` 与自动化消费者。运行 `pnpm card check`，构建并检查受影响条目差异；EJS 的宿主运行与模型生成另行报告。
