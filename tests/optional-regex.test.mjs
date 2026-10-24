import test from "node:test";
import assert from "node:assert/strict";
import { readJSON } from "../tools/lib/card-source.mjs";

// card/regex/optional/ 下的正则合集不装配进卡，玩家在酒馆「正则」面板手动导入。
const OPTIONAL = "card/regex/optional/去古风.json";

// 与锁定的 SillyTavern 1.19 regexFromString 语义一致
function regexFromString(input) {
  const match = input.match(/(\/?)(.+)\1([a-z]*)/i);
  if (!match) return null;
  if (match[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(match[3]))
    return new RegExp(input);
  return new RegExp(match[2], match[3]);
}

// [规则名, 应替换的例句, 相邻但不应改变的例句]
const SAMPLES = [
  ["[去古风]掌柜→老板", "掌柜的笑着迎上来", "老板笑着迎上来"],
  ["[去古风]店小二→侍者", "店小二端来一壶酒", "他比我小二十岁"],
  ["[去古风]客官→客人", "客官里边请", "客人里边请"],
  ["[去古风]一炷香/一盏茶的工夫→一会儿", "过了一炷香的功夫", "她点燃了一炷香"],
  ["[去古风]一刻钟→十五分钟", "约莫一刻钟后", "那一刻，钟声响起"],
  ["[去古风]半刻钟→几分钟", "不到半刻钟", "半刻也不停"],
  ["[去古风]半个时辰→一个小时", "走了半个时辰", "走了半个小时"],
  ["[去古风]一个时辰→两个小时", "足足一个时辰", "足足一个小时"],
  ["[去古风]几个时辰→几个小时", "赶了三个时辰的路", "三个小时"],
  ["[去古风]时辰→时间", "这个时辰街上没人", "这个时候街上没人"],
  ["[去古风]半晌→好一会儿", "她沉默了半晌", "她沉默了半天"],
  ["[去古风]莫要→不要", "莫要乱跑", "不要乱跑"],
  ["[去古风]何须→何必", "何须多言", "必须多言"],
  ["[去古风]床榻/软榻→床", "躺在床榻上", "躺在床上"],
  ["[去古风]大氅→斗篷", "披着黑色大氅", "披着黑色斗篷"],
  ["[去古风]修为→实力", "他的修为深不可测", "他的修行很刻苦"],
  ["[去古风]神通→能力", "施展神通", "神圣通道"],
  ["[去古风]阵眼→法阵核心", "找到阵眼", "一阵眼花"],
  ["[去古风]阵法→法阵", "布下阵法", "战阵冲锋"],
  ["[去古风]文牒/路引→通行证", "出示通关文牒", "出示通行证"],
  ["[去古风]恩准→批准", "陛下恩准了", "陛下准了"],
  ["[去古风]屏退左右→让侍从退下", "女王屏退左右", "女王退下"],
  ["[去古风]屏退→遣退", "她屏退了侍女", "她退了一步"],
  ["[去古风]请安→问好", "向夫人请安", "向夫人问安"],
  ["[去古风]龙椅→王座", "坐上龙椅", "坐上王座"],
  ["[去古风]龙袍→王袍", "身穿龙袍", "身穿龙鳞甲"],
  ["[去古风]衙门→治安所", "去衙门报案", "去治安所报案"],
  ["[去古风]中式自称→我", "妾身不敢", "本王不敢"],
  ["[去古风]拱手/抱拳→行礼", "他抱拳道", "他把城池拱手让人"],
  ["[去古风]作揖→鞠躬", "连连作揖", "连连鞠躬"],
  ["[去古风]铜板/铜钱→铜币", "几枚铜板", "几枚铜币"],
  ["[去古风]碎银/银两→银币", "一块碎银", "一枚银币"],
  ["[去古风]真气/内力/灵力→魔力", "运转真气", "任内力推法案"],
  ["[去古风]经脉→魔力回路", "经脉受损", "叶脉发光"],
  ["[去古风]识海→意识深处", "识海翻涌", "意识海深处"],
  ["[去古风]神识→精神感知", "放出神识", "神情识趣"],
  ["[去古风]神魂→灵魂", "神魂俱灭", "被迷得神魂颠倒"],
  ["[去古风]机缘→机遇", "一场机缘", "一场机遇"],
  ["[去古风]道友→朋友", "这位道友", "这位朋友"],
  ["[去古风]孽障/孽畜→混账", "你这孽障", "你这混账"],
  ["[去古风]街坊→邻居", "街坊邻居都知道", "邻居都知道"],
  ["[去古风]货栈→货仓", "码头边的货栈", "码头边的仓库"],
  ["[去古风]演武场→训练场", "在演武场比试", "在训练场比试"],
  ["[去古风]三更半夜→深夜", "三更半夜不睡觉", "半夜不睡觉"],
  ["[去古风]兵刃→武器", "亮出兵刃", "亮出武器"],
  ["[去古风]青丝→长发", "一头青丝", "一头长发"],
  ["[去古风]衣袂→衣摆", "衣袂飘飘", "衣摆飘飘"],
  ["[去古风]方才→刚才", "方才那人", "才能出众"],
];

test("optional [去古风] regex set is importable, default-off and stays out of the card", async () => {
  const rules = await readJSON(OPTIONAL);
  const card = await readJSON("card/regex/index.json");
  assert.ok(Array.isArray(rules));
  assert.equal(rules.length, SAMPLES.length);
  assert.equal(card.length, 10);
  const cardIds = new Set(card.map((r) => r.id));
  const ids = new Set();
  for (const rule of rules) {
    assert.ok(rule.scriptName.startsWith("[去古风]"), rule.scriptName);
    assert.equal(rule.disabled, true, rule.scriptName);
    assert.deepEqual(rule.placement, [2], rule.scriptName);
    assert.equal(rule.markdownOnly, true, rule.scriptName);
    assert.equal(rule.promptOnly, true, rule.scriptName);
    assert.equal(rule.runOnEdit, false, rule.scriptName);
    assert.equal(typeof rule.replaceString, "string", rule.scriptName);
    assert.ok(rule.id && !ids.has(rule.id) && !cardIds.has(rule.id), rule.scriptName);
    ids.add(rule.id);
    assert.ok(regexFromString(rule.findRegex), rule.scriptName);
  }
});

test("each [去古风] rule replaces its sample and leaves the neighbouring sample alone", async () => {
  const rules = new Map(
    (await readJSON(OPTIONAL)).map((rule) => [rule.scriptName, rule]),
  );
  for (const [name, hit, miss] of SAMPLES) {
    const rule = rules.get(name);
    assert.ok(rule, `缺少规则 ${name}`);
    const re = regexFromString(rule.findRegex);
    assert.notEqual(hit.replace(re, rule.replaceString), hit, `${name} 未命中: ${hit}`);
    assert.equal(miss.replace(re, rule.replaceString), miss, `${name} 误伤: ${miss}`);
  }
});
