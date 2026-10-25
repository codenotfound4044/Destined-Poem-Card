import {
  shouldExcludeCommand,
  handleCommandParsed,
  readCommandPolicies,
  toSegments,
} from '../../src/runtime/command-policy';

const command = (type: string, args: string[]): Mvu.CommandInfo =>
  ({ type, args, full_match: '', reason: '' }) as unknown as Mvu.CommandInfo;

/** 照搬 MVU 0.196.0 extractJsonPatch 的路径与参数形状（references/upstream/mvu/src/function/update_variables.ts）。 */
const bracket = (segments: string[]) =>
  segments.map(segment => `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('');
const pointer = (path: string) => bracket(path.replace(/^\//, '').split('/'));
const patch = (op: Record<string, unknown>): Mvu.CommandInfo => {
  const path = pointer(String(op.path));
  const value = JSON.stringify(op.value);
  switch (op.op) {
    case 'replace':
      return command('set', [path, value]);
    case 'delta':
      return command('add', [path, value]);
    case 'add':
    case 'insert': {
      const parts = _.toPath(path);
      const last = parts[parts.length - 1];
      const key = /^\d+$/.test(last) ? last : JSON.stringify(last);
      return command('insert', [bracket(parts.slice(0, -1)), key, value]);
    }
    case 'remove':
      return command('delete', [path]);
    case 'move':
      return command('move', [pointer(String(op.from)), path]);
    default:
      throw new Error(`unknown op ${op.op}`);
  }
};

describe('toSegments', () => {
  test.each([
    ['["事件"]["信号"]', ['事件', '信号']],
    ["'事件.信号'", ['事件', '信号']],
    ['stat_data.事件.信号', ['事件', '信号']],
    ['"stat_data.事件.信号[0]"', ['事件', '信号', '0']],
    ['', []],
  ])('%s', (path, expected) => {
    expect(toSegments(path)).toEqual(expected);
  });
});

describe('JSON Patch 写法（MVU 0.196.0 的实际形状）', () => {
  test.each([
    ['追加信号', { op: 'insert', path: '/事件/信号/-', value: '示例_st82' }],
    ['add 追加信号', { op: 'add', path: '/事件/信号/-', value: '示例_st82' }],
    ['在指定位置插入信号', { op: 'insert', path: '/事件/信号/0', value: '示例_st82' }],
    ['更新事件阶段', { op: 'replace', path: '/事件/阶段', value: '第二章' }],
    ['写已完成事件', { op: 'insert', path: '/事件/已完成事件/-', value: '已完成事件X' }],
    ['写世界事件字段', { op: 'replace', path: '/事件/冰之歌/异神已击败', value: true }],
    ['无关变量', { op: 'replace', path: '/世界/地点', value: '雾晶港' }],
  ])('放行：%s', (_name, op) => {
    expect(shouldExcludeCommand(patch(op))).toBe(false);
  });

  test.each([
    ['覆盖整个信号数组', { op: 'replace', path: '/事件/信号', value: [] }],
    ['重建信号键', { op: 'add', path: '/事件/信号', value: [] }],
    ['删除整个信号数组', { op: 'remove', path: '/事件/信号' }],
    ['删除单个信号', { op: 'remove', path: '/事件/信号/0' }],
    ['改写单个信号', { op: 'replace', path: '/事件/信号/0', value: 'x' }],
    ['整体覆盖事件', { op: 'replace', path: '/事件', value: { 开启: false } }],
    ['删除整个事件', { op: 'remove', path: '/事件' }],
    ['在根上重建事件', { op: 'add', path: '/事件', value: {} }],
  ])('拦截：%s', (_name, op) => {
    expect(shouldExcludeCommand(patch(op))).toBe(true);
  });

  test.each([
    ['移出信号', { op: 'move', from: '/事件/信号', path: '/临时' }],
    ['移入信号', { op: 'move', from: '/临时', path: '/事件/信号' }],
    ['移走单个信号', { op: 'move', from: '/事件/信号/0', path: '/临时' }],
  ])('拦截：%s', (_name, op) => {
    expect(shouldExcludeCommand(patch(op))).toBe(true);
  });
});

describe('旧式命令（COMMAND_PARSED 时仍带引号）', () => {
  test.each([
    ['insert', ["'事件.信号'", "'示例_st82'"]],
    ['set', ["'事件.阶段'", "'第二章'"]],
    ['insert', ["'事件'", '{"开启":true}']],
    ['set', ["''", '{}']],
  ])('放行 %s %j', (type, args) => {
    expect(shouldExcludeCommand(command(type, args))).toBe(false);
  });

  test.each([
    ['set', ["'事件.信号'", '[]']],
    ['set', ['stat_data.事件.信号', '[]']],
    ['add', ["'事件.信号'", '1']],
    ['delete', ["'事件.信号'"]],
    ['delete', ["'事件.信号'", "'示例_st82'"]],
    ['delete', ["'事件'", "'信号'"]],
    ['insert', ["'事件'", "'信号'", '[]']],
    ['insert', ["'事件'", '{"信号":[]}']],
    ['insert', ["''", '{"事件":{"信号":[]}}']],
    ['set', ["'事件'", '{}']],
  ])('拦截 %s %j', (type, args) => {
    expect(shouldExcludeCommand(command(type, args))).toBe(true);
  });
});

describe('变量里的规则（热加载）', () => {
  const setVariables = (reader: (option: { type: string }) => unknown) => {
    Object.assign(globalThis, { getVariables: reader });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'getVariables');
  });

  test('解析规则，忽略坏条目', () => {
    expect(
      readCommandPolicies({
        命令保护: {
          规则: {
            '事件.信号': { 允许: ['insert', 'bogus'], 保护父级: true, 阻止合并: false },
            '': { 允许: ['write'] },
            不是对象: 'x',
          },
        },
      })
    ).toEqual([
      { path: ['事件', '信号'], allow: ['insert'], protectAncestors: true, blockMerge: false },
    ]);
  });

  test('聊天变量覆盖角色卡，改完下一条命令即生效', () => {
    let chat = { 命令保护: { 规则: { '事件.信号': { 允许: ['append'] } } } };
    setVariables(option =>
      option.type === 'chat'
        ? chat
        : { 命令保护: { 规则: { '事件.信号': { 允许: ['append', 'insert'] } } } }
    );
    const append = patch({ op: 'insert', path: '/事件/信号/-', value: 'a' });
    const insertAt = patch({ op: 'insert', path: '/事件/信号/0', value: 'a' });

    expect(shouldExcludeCommand(append)).toBe(false);
    expect(shouldExcludeCommand(insertAt)).toBe(true);

    chat = { 命令保护: { 规则: { '事件.信号': { 允许: ['append', 'insert'] } } } };
    expect(shouldExcludeCommand(insertAt)).toBe(false);
  });

  test('规则只读变量表根部，stat_data 里的同名规则不生效', () => {
    setVariables(option =>
      option.type === 'character'
        ? { stat_data: { 命令保护: { 规则: { '事件.信号': { 允许: [] } } } } }
        : {}
    );

    expect(shouldExcludeCommand(patch({ op: 'insert', path: '/事件/信号/-', value: 'a' }))).toBe(
      false
    );
  });

  test('变量里新增的路径和内置规则同时生效', () => {
    setVariables(() => ({ 命令保护: { 规则: { '世界.地点': { 允许: [] } } } }));

    expect(
      shouldExcludeCommand(patch({ op: 'replace', path: '/世界/地点', value: '雾晶港' }))
    ).toBe(true);
    expect(shouldExcludeCommand(patch({ op: 'insert', path: '/事件/信号/-', value: 'a' }))).toBe(
      false
    );
  });
});

test('handleCommandParsed 原地删除被拦截的命令', () => {
  const keep = patch({ op: 'insert', path: '/事件/信号/-', value: 'a' });
  const stage = patch({ op: 'replace', path: '/事件/阶段', value: '第二章' });
  const drop = patch({ op: 'remove', path: '/事件/信号/0' });
  const commands = [keep, drop, stage];
  handleCommandParsed({} as Mvu.MvuData, commands);
  expect(commands).toEqual([keep, stage]);
});
