/**
 * MVU 命令保护规则。
 *
 * 规则在每次 `COMMAND_PARSED` 时读取，所以可以在聊天中直接改变量热加载：
 * - 角色卡变量（`getVariables({ type: 'character' })`）作为默认规则
 * - 聊天变量（`getVariables({ type: 'chat' })`）里同路径的规则覆盖角色卡
 *
 * 变量结构：规则放在变量表根部的 `命令保护.规则` 下，角色卡变量和聊天变量同一位置，
 * 不要放进 `stat_data`（聊天变量的 `stat_data` 每轮会被 MVU 从消息变量同步，配置会丢，
 * 也不该混进游戏状态）。
 *
 * ```json
 * {
 *   "命令保护": {
 *     "规则": {
 *       "事件.信号": {
 *         "允许": ["append", "insert"],
 *         "保护父级": true,
 *         "阻止合并": true
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * 操作名（按命令对字段的实际效果划分）：
 * - `write`：整体写入该字段，覆盖原值（JSON Patch 的 `replace`、`add`/`delta`，旧式 `_.set`）
 * - `append`：追加——往数组末尾加元素（`insert …/-`），或把对象合并进该字段、不覆盖已有键
 * - `insert`：按位置插入数组元素，例如 `insert /事件/信号/0`
 * - `remove`：删除该字段或它下面的键（`remove`、旧式 `_.unset`）
 * - `move`：移动该字段，起点或终点任一端命中都算（`move`）
 *
 * `允许` 之外的操作用于该字段时会被丢弃；`保护父级` 拒绝整体写入、删除、移动父级字段
 * （根对象除外）；`阻止合并` 拒绝把带该字段的值合并进父级。
 */
export type PolicyOperation = 'write' | 'append' | 'insert' | 'remove' | 'move';

export interface CommandPolicy {
  /** 受保护字段的路径分段，如 `['事件', '信号']`。 */
  path: readonly string[];
  /** 允许对该字段做的操作，未列出的操作会被丢弃。 */
  allow: readonly PolicyOperation[];
  /** 是否保护父级字段。 */
  protectAncestors: boolean;
  /** 合并进父级时是否检查值里是否带该字段。 */
  blockMerge: boolean;
}

/** 变量里的规则键。 */
export const POLICY_VARIABLE_KEY = '命令保护';

/** 没有任何变量配置时使用的内置规则。 */
export const DEFAULT_COMMAND_POLICIES: readonly CommandPolicy[] = [
  {
    path: ['事件', '信号'],
    allow: ['append', 'insert'],
    protectAncestors: true,
    blockMerge: true,
  },
];
