// 世界书缩进挂靠检查，规则见 docs/worldbook-tree.md。
//
// 条目正文是 YAML 片段，子条目靠缩进挂在前一条下面。酒馆按顺序升序输出同一位置的条目，
// 同号时先后与清单次序相反，黏性条目还会被提前，所以这里不模拟同号先后，只检查
// 不依赖它的条件：父块到最后一个子块的号段里不能混进别的条目。

/** 正文第一行内容的缩进；只有注释或包裹标签（分割线、<势力>）时返回 null，不参与挂靠。 */
export function bodyIndent(text) {
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("<")) continue;
    return line.length - line.trimStart().length;
  }
  return null;
}

const groupKey = ({ position, depth, role }) =>
  position === "指定深度" ? `${position}|${depth}|${role}` : position;

/**
 * @param {{name: string, position: string, order: number, depth?: number, role?: string,
 *          sticky?: number, indent: number | null}[]} items 已启用条目，按清单次序
 * @returns {string[]} 问题描述
 */
export function nestingIssues(items) {
  const issues = [];
  const groups = new Map();
  for (const item of items) {
    if (item.indent === null) continue;
    const key = groupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const list of groups.values()) {
    // 按清单次序和缩进建树：每条的父级是前面最近一条缩进更小的条目。
    const stack = [];
    const children = new Map(list.map((item) => [item, []]));
    const parentOf = new Map();
    for (const item of list) {
      while (stack.length && stack.at(-1).indent >= item.indent) stack.pop();
      if (item.indent > 0 && stack.length) {
        const parent = stack.at(-1);
        parentOf.set(item, parent);
        children.get(parent).push(item);
      }
      stack.push(item);
    }
    const descendants = (item) =>
      children.get(item).flatMap((child) => [child, ...descendants(child)]);

    for (const [child, parent] of parentOf) {
      if (child.order <= parent.order)
        issues.push(
          `顺序 ${child.order} 不大于父条目 ${parent.order}: ${child.name} ← ${parent.name}`,
        );
      if ((child.sticky ?? 0) > (parent.sticky ?? 0))
        issues.push(
          `黏性 ${child.sticky} 大于父条目 ${parent.sticky ?? 0}: ${child.name} ← ${parent.name}`,
        );
    }
    for (const parent of list) {
      const subtree = descendants(parent);
      if (!subtree.length) continue;
      const low = parent.order;
      const high = Math.max(...subtree.map((item) => item.order));
      const members = new Set([parent, ...subtree]);
      const intruders = list.filter(
        (item) => !members.has(item) && item.order >= low && item.order <= high,
      );
      if (intruders.length)
        issues.push(
          `号段 ${low}~${high} 混入非子条目，子条目可能挂错父级: ${parent.name} ⇐ ${intruders
            .map((item) => `${item.name}(${item.order})`)
            .join("、")}`,
        );
    }
  }
  return issues;
}

/** 从 loadWorldbook() 的结果收集挂靠检查输入。 */
export async function nestingItems(references, readBody) {
  const items = [];
  for (const { entry, file } of references) {
    if (!entry.启用) continue;
    const position = entry.插入位置 ?? {};
    items.push({
      name: entry.名称,
      position: position.类型,
      order: position.顺序 ?? 100,
      depth: position.深度,
      role: position.角色,
      sticky: entry.特殊效果?.黏性,
      indent: bodyIndent(await readBody(file)),
    });
  }
  return items;
}
