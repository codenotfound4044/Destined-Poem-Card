---
name: prompt-style
description: 编写、修改或审查命定之诗的模型提示词时使用，处理古风回潮、重复提醒和多余的防备性要求。
---

# 提示词文风审校

先读 [提示词写作与古风清理](../../../docs/archaic-wording-cleanup.md) 的写作规则和保留项，审校任务指定的文本或本次改动。

## 定位模型输入

用 `pnpm card map <关键词>` 或源码检索找到文本及其消费者，确认装配和激活方式。

| 来源 | 要核对的入口 |
| --- | --- |
| 世界书、事件、角色与系统指令 | `worldbook/命定之诗.yaml` 和引用正文 |
| 开场白 | `card/greetings/index.json` 和引用文本 |
| 自动化注入 | `packages/automation/src/prompts/` 及生成文案的 `services/`，由 `runtime/prompts.ts` 注入 |
| 开局及描述数据 | `content/catalogs/` 与 `packages/frontend/src/apps/custom-start/core/utils/data-exporter.ts` 等消费者 |
| 地理说明 | `content/geography/places.yaml` 的 `description.brief/detail`，由世界书《长途移动与地理参考》读取；`marker.description` 当前仅用于前端地图 |

## 审校

读完整段落，结合所属文化、角色口吻和游戏机制判断词句与设施、机构命名的整体风格；检索用于补漏。

检查冗余时，对照会同时注入的规则和模板，找出重复提醒及缺少具体依据的防错要求。独立激活条目按各自需要的上下文判断。

改写自然语言，保留设定含义、模板逻辑和变量写入约定。审查任务给出文件位置、原句、原因和建议；修改任务完成后简要说明改动，验证遵循 [修改与验证](../../../docs/workflow.md)。
