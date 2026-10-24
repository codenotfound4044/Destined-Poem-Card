/**
 * MVU 命令过滤：`事件.信号` 只能追加。
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

const PROTECTED_PATHS: readonly (readonly string[])[] = [['事件', '信号']];

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

const violates = (command: Mvu.CommandInfo, protectedPath: readonly string[]): boolean => {
  const args = command.args as string[];
  /** 目标是受保护字段本身、它内部、或包含它的上级（只算 事件 这一级，不含根）。 */
  const covers = (target: string[]) =>
    startsWith(target, protectedPath) || (target.length > 0 && startsWith(protectedPath, target));

  switch (command.type) {
    case 'insert': {
      const parent = toSegments(args[0]);
      if (args.length === 2) {
        // 追加到数组末尾，或把对象合并进 parent
        if (_.isEqual(parent, protectedPath)) return false;
        if (startsWith(parent, protectedPath)) return true;
        return startsWith(protectedPath, parent) && mergeTouches(parent, args[1], protectedPath);
      }
      // 在指定键或索引处插入：往信号数组里插入新元素只增不删，放行
      if (_.isEqual(parent, protectedPath)) return false;
      return covers([...parent, trimLiteral(args[1])]);
    }
    case 'delete': {
      const target = toSegments(args[0]);
      // 两个参数时第二个是键、索引或要删除的值
      return covers(args.length === 2 ? [...target, trimLiteral(args[1])] : target);
    }
    case 'move':
      return args.some(path => covers(toSegments(path)));
    case 'set':
    case 'add':
    default:
      return covers(toSegments(args[0]));
  }
};

export const shouldExcludeCommand = (command: Mvu.CommandInfo): boolean =>
  PROTECTED_PATHS.some(protectedPath => violates(command, protectedPath));

export const handleCommandParsed = (_variables: Mvu.MvuData, commands: Mvu.CommandInfo[]): void => {
  const retainedCommands = commands.filter(command => !shouldExcludeCommand(command));
  commands.splice(0, commands.length, ...retainedCommands);
};
