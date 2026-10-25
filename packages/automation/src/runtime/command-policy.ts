/**
 * MVU 命令保护：按变量里的声明式规则过滤 `COMMAND_PARSED` 收到的命令。
 *
 * 规则在每次事件里重新读取（`loadCommandPolicies`），所以改完变量下一条消息就生效：
 * - 角色卡变量 `命令保护.规则` 是默认规则
 * - 聊天变量 `命令保护.规则` 里同路径的规则覆盖角色卡
 * - 两者都没有时使用 {@link DEFAULT_COMMAND_POLICIES}
 *
 * COMMAND_PARSED 收到的路径有多种写法，按分段比较而不是按整串比较：
 * - JSON Patch：`["事件"]["信号"]`，不带 stat_data（MVU 0.196.0 的 extractJsonPatch）
 * - 旧式 `_.set('事件.信号', …)`：仍带引号的原始参数，pathFix 在本事件之后才执行
 * - 也兼容带 `stat_data.` 前缀的写法
 *
 * JSON Patch 到命令的对应关系：
 * - replace /a/b      -> set    ['["a"]["b"]', value]
 * - add|insert /a/b/- -> insert ['["a"]["b"]', '"-"', value]
 * - remove /a/b/0     -> delete ['["a"]["b"]["0"]']
 * - move from -> to   -> move   [from, to]
 */
import {
  CommandPolicy,
  DEFAULT_COMMAND_POLICIES,
  POLICY_VARIABLE_KEY,
  PolicyOperation,
} from './command-policy.config';

/** 去掉首尾引号与反斜杠，与 MVU 的 trimQuotesAndBackslashes 一致。 */
const trimLiteral = (value: string): string => value.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');

/** 把任意写法的路径拆成分段，去掉开头的 stat_data。 */
export const toSegments = (path: string): string[] => {
  const segments = _.toPath(trimLiteral(path)).map(trimLiteral);
  return segments[0] === 'stat_data' ? segments.slice(1) : segments;
};

const startsWith = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);

/** 解析值字面量；旧式命令可能是无法用 JSON 解析的 JS 字面量，此时返回 undefined。 */
const parseLiteral = (literal: string): unknown => {
  try {
    return JSON.parse(literal);
  } catch {
    return undefined;
  }
};

/** 合并进 target 的值里是否带有受保护的字段。 */
const mergeTouches = (
  target: string[],
  literal: string,
  protectedPath: readonly string[]
): boolean => {
  const value = parseLiteral(literal);
  if (!_.isPlainObject(value)) return false;
  return _.has(value, protectedPath.slice(target.length));
};

const OPERATIONS: readonly PolicyOperation[] = ['write', 'append', 'insert', 'remove', 'move'];

const isOperation = (value: unknown): value is PolicyOperation =>
  typeof value === 'string' && (OPERATIONS as readonly string[]).includes(value);

const parsePolicy = (path: string, raw: unknown): CommandPolicy | undefined => {
  if (!_.isPlainObject(raw)) return undefined;
  const segments = toSegments(path);
  if (segments.length === 0) return undefined;
  const rule = raw as Record<string, unknown>;
  return {
    path: segments,
    allow: Array.isArray(rule['允许']) ? rule['允许'].filter(isOperation) : [],
    protectAncestors: rule['保护父级'] === true,
    blockMerge: rule['阻止合并'] === true,
  };
};

/** 从一个变量作用域里读出规则；结构不对的条目会被忽略。 */
export const readCommandPolicies = (variables: unknown): CommandPolicy[] => {
  if (!_.isPlainObject(variables)) return [];
  const scope = variables as Record<string, unknown>;
  const config = scope[POLICY_VARIABLE_KEY];
  if (!_.isPlainObject(config)) return [];
  const rules = (config as Record<string, unknown>)['规则'];
  if (!_.isPlainObject(rules)) return [];
  return Object.entries(rules as Record<string, unknown>).flatMap(([path, raw]) => {
    const policy = parsePolicy(path, raw);
    return policy ? [policy] : [];
  });
};

const readScopePolicies = (type: 'character' | 'chat'): CommandPolicy[] => {
  // jest 等没有酒馆助手的运行环境里没有这个全局函数
  if (typeof getVariables !== 'function') return [];
  try {
    return readCommandPolicies(getVariables({ type }));
  } catch {
    // 没有打开角色卡时 getVariables({ type: 'character' }) 会抛错
    return [];
  }
};

/** 读取当前生效的规则：内置默认 -> 角色卡 -> 聊天，后者覆盖前者。 */
export const loadCommandPolicies = (): readonly CommandPolicy[] => {
  const policies: Record<string, CommandPolicy> = {};
  for (const policy of [
    ...DEFAULT_COMMAND_POLICIES,
    ...readScopePolicies('character'),
    ...readScopePolicies('chat'),
  ]) {
    policies[JSON.stringify(policy.path)] = policy;
  }
  return Object.values(policies);
};

interface CommandTarget {
  operation: PolicyOperation;
  target: string[];
}

/** 把命令还原成「对哪个字段做了什么操作」。 */
const readTargets = (command: Mvu.CommandInfo): CommandTarget[] => {
  const args = command.args as string[];
  switch (command.type) {
    case 'insert': {
      const parent = toSegments(args[0]);
      if (args.length === 2) {
        // 往数组追加，或把对象合并进 parent
        return [{ operation: 'append', target: parent }];
      }
      // 三参 insert：`-` 是追加到末尾，数字是按下标插入，其余是写对象键
      const key = trimLiteral(args[1]);
      const operation: PolicyOperation =
        key === '-' ? 'append' : /^-?\d+$/.test(key) ? 'insert' : 'write';
      return [{ operation, target: [...parent, key] }];
    }
    case 'delete': {
      const target = toSegments(args[0]);
      // 两个参数时第二个是键、索引或要删除的值
      return [
        {
          operation: 'remove',
          target: args.length === 2 ? [...target, trimLiteral(args[1])] : target,
        },
      ];
    }
    case 'move':
      return args.map(path => ({ operation: 'move' as const, target: toSegments(path) }));
    case 'set':
    case 'add':
    default:
      return [{ operation: 'write', target: toSegments(args[0]) }];
  }
};

const violates = (command: Mvu.CommandInfo, policy: CommandPolicy): boolean => {
  const path = policy.path;

  for (const { operation, target } of readTargets(command)) {
    if (startsWith(target, path)) {
      // 直接作用于受保护字段或其内部：只放行白名单里的操作
      if (!policy.allow.includes(operation)) return true;
      continue;
    }
    // 作用于上级字段：整体覆盖、删除、移动父级都要拦；合并交给下面的 blockMerge 判断
    if (
      policy.protectAncestors &&
      target.length > 0 &&
      startsWith(path, target) &&
      operation !== 'append'
    ) {
      return true;
    }
  }

  // 二参 insert 是把值合并进 parent：只拦值里带受保护字段的合并
  if (policy.blockMerge && command.type === 'insert' && command.args.length === 2) {
    const parent = toSegments(command.args[0] as string);
    const isStrictAncestor = !startsWith(parent, path) && startsWith(path, parent);
    if (isStrictAncestor && mergeTouches(parent, command.args[1] as string, path)) return true;
  }

  return false;
};

export const shouldExcludeCommand = (
  command: Mvu.CommandInfo,
  policies: readonly CommandPolicy[] = loadCommandPolicies()
): boolean => policies.some(policy => violates(command, policy));

export const handleCommandParsed = (_variables: Mvu.MvuData, commands: Mvu.CommandInfo[]): void => {
  const policies = loadCommandPolicies();
  const retainedCommands = commands.filter(command => !shouldExcludeCommand(command, policies));
  commands.splice(0, commands.length, ...retainedCommands);
};
