---
name: event-chain
description: 编写或修改命定之诗的剧情事件（事件链）、事件阶段、事件信号，或排查事件不触发、卡阶段、信号丢失时使用。覆盖 worldbook/命定之诗/事件/ 下的 EJS 条目和 packages/automation 中的事件处理。
---

先读 [事件链与事件信号](../../../docs/event-chain.md)，再读一个同类型的现有事件当样板：主线事件看 `worldbook/命定之诗/事件/群山回响/`，信号事件看 `斯芬克斯(aoo).ejs`（简单）或 `神选者/神选者(aoo).ejs`（分阶段），世界事件看 `冰之歌(aoo).ejs`。不要一次读完所有事件正文。

动笔前确定并在回复里写明：

- 写法：主线事件（占全局事件槽，同时只能一个）、信号事件（可并行）还是世界事件。
- 唯一标识：主线事件的标题，或信号事件的信号前缀；先在 `worldbook/` 里搜一遍，确认没有重名。
- 每个阶段的进入条件、结束条件，以及结束时要写的 JSON Patch。

写的时候：

- `事件` 整块对模型不可见，模型只靠 `<event>` 里的指令写变量；每个需要模型写变量的地方都给出完整的 JSON Patch 原文。
- 信号只追加（`insert /事件/信号/-`），信号值写成 EJS 常量并用 `<%= %>` 输出。
- 新状态只放在 `事件.<事件名>` 下，不改 `开启/结束/标题/阶段/已完成事件/信号` 的含义，不改 `packages/game/src/schema/`。
- `Math.random()` 只决定第一次出现，出现后用不随机的条件续上。
- 条目配置按文档第三、四、七节：名称 `[DLC][事件][事件名]…(作者-简介)`、默认 `启用: false`、放在 `➡️事件开始` 与 `➡️事件结束` 之间、递归两项 true。

改 `packages/automation/src/services/event.ts`、`prompts/event-prompts.ts` 或 `runtime/command-policy.ts` 时同时读 [automation](../automation/SKILL.md)，并跑 `pnpm --filter @destiny/automation test`。

交付前跑 `pnpm card check` 和 `node tools/check-templates.mjs`。后者只编译 EJS，不执行；入口出现、阶段推进、结束复位、信号追加、重新生成、开关额外模型更新变量这些都要在酒馆里看楼层变量和提示词预览，没测的明确写未实测。
