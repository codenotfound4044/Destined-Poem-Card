import test from "node:test";
import assert from "node:assert/strict";
import { bodyIndent, nestingIssues } from "../tools/lib/worldbook-nesting.mjs";

const entry = (name, order, indent, extra = {}) => ({
  name,
  position: "角色定义之前",
  order,
  indent,
  ...extra,
});

test("bodyIndent 跳过文档分隔、注释和包裹标签", () => {
  assert.equal(bodyIndent("---\n挽歌堡:\n  概览: x\n"), 0);
  assert.equal(bodyIndent("﻿\r\n    黑冠台: |\r\n      x\r\n"), 4);
  assert.equal(bodyIndent("#长夜之境\n"), null);
  assert.equal(bodyIndent("<势力>\n"), null);
});

test("每座城市独立号段时没有问题", () => {
  const items = [
    entry("分割线", 90, null),
    entry("永夜长垣", 91, 0),
    entry("挽歌堡", 92, 0),
    entry("黑冠台", 93, 4),
    entry("热泉坊", 93, 4),
    entry("白曜城", 96, 0),
    entry("冠石台", 97, 4),
  ];
  assert.deepEqual(nestingIssues(items), []);
});

test("两座城市共用号段时报告", () => {
  const items = [
    entry("龙吼堡垒", 113, 0),
    entry("试炼阶梯", 114, 4),
    entry("白港", 113, 0),
    entry("港湾区", 114, 4),
  ];
  const issues = nestingIssues(items);
  assert.ok(issues.some((issue) => issue.includes("龙吼堡垒") && issue.includes("白港")));
});

test("同号的独立条目也会打乱挂靠", () => {
  const items = [entry("灰岩镇", 110, 0), entry("琥珀加德", 110, 0), entry("麦市区", 111, 4)];
  assert.ok(nestingIssues(items).some((issue) => issue.includes("灰岩镇(110)")));
});

test("子条目顺序不大于父条目、黏性大于父条目时报告", () => {
  const items = [
    entry("苍白海", 94, 0),
    entry("内苍白海", 94, 2),
    entry("雾晶港", 123, 0),
    entry("政治与社会", 124, 2, { sticky: 10 }),
  ];
  const issues = nestingIssues(items);
  assert.ok(issues.some((issue) => issue.startsWith("顺序 94 不大于父条目 94")));
  assert.ok(issues.some((issue) => issue.startsWith("黏性 10 大于父条目 0")));
});

test("不同插入位置、不同深度分开检查", () => {
  const items = [
    entry("父", 10, 0),
    { ...entry("子", 11, 2), position: "角色定义之后" },
    { ...entry("深度父", 10, 0), position: "指定深度", depth: 1, role: "系统" },
    { ...entry("深度子", 11, 2), position: "指定深度", depth: 2, role: "系统" },
  ];
  assert.deepEqual(nestingIssues(items), []);
});
