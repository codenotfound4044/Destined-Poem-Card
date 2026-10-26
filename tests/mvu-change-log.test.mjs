import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ejs from 'ejs';
import _ from 'lodash';
import YAML from 'yaml';

const root = new URL('../worldbook/命定之诗/变量/', import.meta.url);
const source = async name => fs.readFile(new URL(name, root), 'utf8');
const shared = {};
{
  const text = await source('公共函数.ejs');
  // ST-Prompt-Template removes decorators before evaluating special entries.
  await ejs.render(text.replace(/^@@[^\n]*\n/gm, ''), { _, define: (key, value) => { shared[key] = value; } }, { async: true });
}
const logSource = await source('mvu变量修改日志.ejs');
const displaySource = await source('variables.ejs');
const state = (health = 100) => ({ 世界: { 时间: '复兴纪元488年-3月-15日-星期一-14:00' }, 主角: { 生命: health } });
const render = async (states, messages, generateType = 'normal') => {
  const reads = [];
  const result = await ejs.render(logSource, {
    ...shared, SillyTavern: { chat: messages }, generateType,
    getMessageVar(key, options) { const id = options.withMsg.id; reads.push(id); return states[id] ?? null; },
  }, { async: true });
  return { result, reads };
};
const alternating = count => Array.from({ length: count }, (_, id) => ({ is_user: id % 2 === 0 }));

test('variable display explains missing shared function configuration without reading raw state', async () => {
  const output = await ejs.render(displaySource, {
    YAML,
    getMessageVar() { throw new Error('must not read unfiltered state'); },
  }, { async: true });
  assert.match(output, /公共函数/);
  assert.match(output, /启用 generate before\/after 注入支持/);
});


test('log and display omit internal events, hidden objects, absent private fields and locked ascension without mutating snapshots', async () => {
  const before = state();
  before.事件 = { 信号: ['secret-before'] };
  before.主角.背包 = { '隐藏物品': { _隐藏: true, 数量: 1 } };
  before.主角.登神长阶 = { 是否开启: false, 神位: '旧隐藏神位' };
  before.关系列表 = {
    '隐藏伙伴': { _隐藏: true, 生命: 100 },
    '离场伙伴': { 在场: false, 命定契约: false, 生命: 100, 性格: '安静' },
    '在场伙伴': { 在场: true, 等级: 1, 登神长阶: { 是否开启: true, 神位: '未解锁神位' } },
  };
  const after = _.cloneDeep(before);
  after.事件.信号.push('secret-after');
  after.主角.背包.隐藏物品.数量 = 9;
  after.主角.登神长阶.神位 = '新隐藏神位';
  after.关系列表.隐藏伙伴.生命 = 5;
  after.关系列表.离场伙伴.生命 = 5;
  after.关系列表.在场伙伴.登神长阶.神位 = '另一个未解锁神位';
  const snapshots = _.cloneDeep([before, after]);
  const hidden = await render([before, after, after], alternating(3));
  assert.equal(hidden.result.trim(), '');
  after.主角.生命 = 90;
  after.关系列表.离场伙伴.性格 = '活泼';
  const visible = await render([before, after, after], alternating(3));
  assert.match(visible.result, /生命-10/);
  assert.match(visible.result, /离场伙伴.*性格更新/);
  assert.doesNotMatch(visible.result, /事件|信号|secret|隐藏物品|隐藏伙伴|神位/);
  const display = await ejs.render(displaySource, { ...shared, YAML, getMessageVar: () => after }, { async: true });
  assert.doesNotMatch(display, /secret|隐藏物品|隐藏伙伴|神位/);
  assert.match(display, /生命: 90/);
  after.主角.生命 = 100;
  after.关系列表.离场伙伴.性格 = '安静';
  assert.deepEqual([before, after], snapshots);
});

test('newly hidden objects and absent private fields stay out of removal logs, while real deletions remain', async () => {
  const before = state();
  before.主角.背包 = {
    '秘密钥匙': { _隐藏: false, 数量: 1 },
    '已消耗药水': { _隐藏: false, 数量: 1 },
  };
  before.关系列表 = {
    '隐藏同伴': { _隐藏: false, 在场: true, 生命: 100 },
    '离场同伴': { 在场: true, 命定契约: false, 背包: { '秘密文件': { 数量: 1 } } },
  };
  const after = _.cloneDeep(before);
  after.主角.背包.秘密钥匙._隐藏 = true;
  delete after.主角.背包.已消耗药水;
  after.关系列表.隐藏同伴._隐藏 = true;
  after.关系列表.离场同伴.在场 = false;
  const original = _.cloneDeep([before, after]);
  const { result } = await render([before, after, after], alternating(3));
  assert.doesNotMatch(result, /秘密钥匙|隐藏同伴|秘密文件|背包移除/);
  assert.match(result, /已消耗药水移除/);
  assert.match(result, /在场=false/);
  assert.deepEqual([before, after], original);
  const revealed = await render([after, before, before], alternating(3));
  assert.match(revealed.result, /秘密钥匙新增/);
  assert.match(revealed.result, /隐藏同伴新增/);
  assert.doesNotMatch(revealed.result, /数量|生命/);
});

test('regenerate uses the remaining previous round after the host deletes its target reply', async () => {
  const states = [state(100), state(90), state(90), state(70), state(70)];
  const result = await render(states, alternating(5), 'regenerate');
  assert.match(result.result, /生命-20/);
  assert.doesNotMatch(result.result, /生命-10/);
});

for (const type of ['swipe', 'continue', 'append', 'appendFinal']) {
  test(`${type} excludes the target assistant snapshot still present in chat`, async () => {
    const states = [state(100), state(90), state(90), state(70), state(70), state(1)];
    const result = await render(states, alternating(6), type);
    assert.match(result.result, /生命-20/);
    assert.ok(!result.reads.includes(5));
  });
}

test('bounded searches do not use snapshots outside the last twenty messages', async () => {
  const states = [state(100), ...Array(24).fill(null)];
  const result = await render(states, alternating(25));
  assert.equal(result.result.trim(), '');
  assert.ok(result.reads.every(id => id >= 5));
});

test('invalid current time is reported even without a baseline, while valid unchanged state stays silent', async () => {
  const invalid = state();
  invalid.世界.时间 = '非法时间';
  const output = await render([invalid], alternating(1));
  assert.match(output.result, /修正 \/世界\/时间/);
  const unchanged = await render([state(), state(), state()], alternating(3));
  assert.equal(unchanged.result.trim(), '');
});
