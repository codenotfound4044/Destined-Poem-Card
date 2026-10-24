---
name: regex
description: 修改角色卡正则替换、显示占位符或开场白渲染匹配时使用，检查 card 中有序规则及其前端资源目标。
---

先定位 `card/regex/index.json` 中实际正则定义，独立替换模板在 `card/regex/views/`，确认匹配对象、启用状态、运行阶段、深度、捕获组与替换文本；保留十条规则的顺序，除非任务明确需要调整。`card/regex/optional/` 下是不装配进卡、供玩家在酒馆手动导入的可选正则合集（如「[去古风]」，说明见 [古风词汇清理](../../../docs/archaic-wording-cleanup.md)），改动时同步 `tests/optional-regex.test.mjs` 的例句。

宿主正则语义通过 `pnpm refs search <关键词> --source sillytavern` 查询，重点看 `public/scripts/extensions/regex/engine.js`；宏和 slash command 不等于 JavaScript 正则，分别查对应实现。参考入口见 [知识源](../../../docs/references.md)。

若规则加载前端资源，同时检查 local/release 资源根、`card/greetings/index.json` 的三条开场白及目标入口，见 [角色卡契约](../../../docs/contracts.md)。用实际触发样本和至少一个相邻不应匹配的样本核对结果，避免只验证正则能编译。

运行 `pnpm card check`、构建并查看卡差异。说明哪些替换结果在酒馆内实际确认；不通过直接改导出 JSON 修复源码问题。
