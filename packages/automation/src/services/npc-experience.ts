/**
 * NPC 经验与升级服务
 *
 * NPC（关系列表）的经验系统：
 * - 经验数据存储在 date.npcs 中
 * - 经验增量跟随主角的累计经验值变化
 * - 只有「在场」（如果需要契约则「命定契约」）的 NPC 才能获得经验
 */

import {
  AttributeKeys,
  GameConfig,
  getMilestoneForLevel,
  getRequiredXpForLevel,
  getTierForLevel,
  isMaxLevel,
  LevelXpTable,
} from '../config';
import type { MessageVariables, NpcExpData } from '../types';
import { safeGet } from '../utils';

/** NPC 各生命层级的单项属性上限 */
const NPC_TIER_ATTR_CAP: Readonly<Record<string, number>> = {
  '第一层级/普通': 8,
  '第二层级/中坚': 10,
  '第三层级/精英': 12,
  '第四层级/史诗': 14,
  '第五层级/传说': 16,
  '第六层级/神话': 18,
  '第七层级/登神': 20,
};

/** 根据生命层级获取属性上限 */
const getNpcAttrCapByTier = (tier: string): number => {
  return NPC_TIER_ATTR_CAP[tier] ?? 8;
};

/**
 * NPC 升级门槛等级
 * 当 NPC 升到这些等级时，本轮升级循环会中断，
 * 需要在下一个消息周期才能继续突破到下一层级（13/17/21/25）。
 */
const NPC_LEVEL_GATES: ReadonlySet<number> = new Set([12, 16, 20, 24]);

/**
 * 加权随机选择一个属性进行加点
 *
 * - 权重 = max(1, baseValue²)，基础属性越高越容易被选中（强者恒强）
 * - 当前值（基础 + 单级加点 + 层级加点）已达上限的属性会被排除
 *
 * @returns 被选中的属性键名，若所有属性都已满则返回 null
 */
const weightedPickNpcAttribute = (
  baseAttrs: Record<string, number>,
  pendingSingleAdds: Record<string, number>,
  pendingTierAdds: Record<string, number>,
  cap: number
): (typeof AttributeKeys)[number] | null => {
  const candidates: Array<{ key: (typeof AttributeKeys)[number]; weight: number }> = [];

  _.forEach(AttributeKeys, key => {
    const baseValue = Number(baseAttrs[key] || 0);
    const singleAdd = Number(pendingSingleAdds[key] || 0);
    const tierAdd = Number(pendingTierAdds[key] || 0);
    const currentValue = baseValue + singleAdd + tierAdd;

    if (currentValue >= cap) return;

    // 高属性值给予更高权重（平方），使 NPC 形成差异化特长
    const weight = Math.max(1, baseValue * baseValue);
    candidates.push({ key, weight });
  });

  if (candidates.length === 0) return null;

  const totalWeight = _.sumBy(candidates, 'weight');
  let roll = Math.random() * totalWeight;
  let picked: (typeof AttributeKeys)[number] =
    candidates[candidates.length - 1]?.key ?? AttributeKeys[0];

  for (const item of candidates) {
    roll -= item.weight;
    if (roll <= 0) {
      picked = item.key;
      break;
    }
  }

  return picked;
};

/**
 * 处理所有 NPC 的经验与升级
 *
 * @param new_variables - 更新后的变量数据
 * @param old_variables - 更新前的变量数据（由 MVU 事件提供）
 */
export const processNPCExperienceAndLevel = (
  new_variables: MessageVariables,
  old_variables: MessageVariables,
  messageId: number
): void => {
  const destined = safeGet(new_variables, 'stat_data.关系列表', {} as Record<string, any>);
  const requiresContract = safeGet(new_variables, 'date.requiresContractForExp', true);
  const npcLevelUpWithPlayer = safeGet(new_variables, 'date.npcLevelUpWithPlayer', true);

  //如果不允许直接退出函数
  if (!npcLevelUpWithPlayer) {
    return;
  }
  // 获取现有的 date.npcs 数据，如果不存在则创建空对象
  const dateNpcs: Record<string, NpcExpData> = safeGet(new_variables, 'date.npcs', {});

  // 计算主角经验增量
  const currentExp = safeGet(new_variables, 'stat_data.主角.累计经验值', 0);
  const oldExp = safeGet(old_variables, 'stat_data.主角.累计经验值', currentExp);
  const deltaExp = currentExp - oldExp;

  // 早期初始化阶段仅同步，不进行经验结算
  const isInitDryRun = messageId <= 3;

  // 同步：添加关系列表中存在但 date.npcs 中不存在的对象
  _.forEach(destined, (npc, name) => {
    if (!dateNpcs[name]) {
      _.set(dateNpcs, name, {
        level: npc.等级,
        exp: 0,
        required_exp: getRequiredXpForLevel(npc.等级),
      });
    }
  });

  // 同步：删除 date.npcs 中存在但关系列表中不存在的对象
  _.forEach(_.keys(dateNpcs), name => {
    if (!destined[name]) {
      _.unset(dateNpcs, name);
    }
  });

  // 升级提示收集
  const levelUpPrompts: string[] = [];

  // 处理每个 NPC
  _.forEach(dateNpcs, (npcData: NpcExpData, name: string) => {
    const npc = destined[name];
    if (!npc) return;

    const oldNpcLevel = safeGet(
      old_variables,
      `stat_data.关系列表.${name}.等级`,
      undefined as number | undefined
    );
    const isManualLevelSet = typeof oldNpcLevel !== 'number' || oldNpcLevel !== npc.等级;
    const initialAttributes = _.fromPairs(
      _.map(AttributeKeys, attrKey => [attrKey, Number(safeGet(npc, `属性.${attrKey}`, 0)) || 0])
    ) as Record<(typeof AttributeKeys)[number], number>;
    // 记录普通升级时的随机属性增量
    const levelAttributeGain = _.fromPairs(_.map(AttributeKeys, attrKey => [attrKey, 0])) as Record<
      (typeof AttributeKeys)[number],
      number
    >;
    // 记录层级突破带来的里程碑属性增量
    const milestoneAttributeGain = _.fromPairs(
      _.map(AttributeKeys, attrKey => [attrKey, 0])
    ) as Record<(typeof AttributeKeys)[number], number>;

    // 同步等级（使用 _.set 确保写入）
    _.set(npcData, 'level', npc.等级);
    _.set(npcData, 'required_exp', getRequiredXpForLevel(npcData.level));

    const prevRequired = npcData.level > 1 ? LevelXpTable[npcData.level - 1] : 0;

    // 手动设置等级时，将经验对齐到前一级，避免被动升一级
    if (isManualLevelSet) {
      if (typeof prevRequired === 'number') {
        _.set(npcData, 'exp', prevRequired);
      }
    } else if (npcData.level > 1) {
      // 确保经验不低于前一级所需
      if (typeof prevRequired === 'number' && npcData.exp < prevRequired) {
        _.set(npcData, 'exp', prevRequired);
      }
    }

    const shouldProcessExp = !isInitDryRun && !isManualLevelSet;
    const characterLevel = safeGet(new_variables, 'stat_data.主角.等级', 1);

    // 经验增加：在场 + 经验增量 > 0 + （需要契约时要命定契约为 true）
    const canGainExp =
      shouldProcessExp &&
      npc.在场 &&
      deltaExp > 0 &&
      (!requiresContract || npc.命定契约) &&
      npc.等级 < characterLevel;
    if (canGainExp) {
      _.set(npcData, 'exp', npcData.exp + deltaExp);
    }

    // 升级检查
    const initialLevel = npc.等级;
    let previousTier = safeGet(
      old_variables,
      `stat_data.关系列表.${name}.生命层级`,
      getTierForLevel(initialLevel)
    );

    while (shouldProcessExp && npcData.exp >= npcData.required_exp && !isMaxLevel(npcData.level)) {
      _.set(npcData, 'level', npcData.level + 1);
      _.set(npcData, 'required_exp', getRequiredXpForLevel(npcData.level));

      const currentTier = getTierForLevel(npcData.level);
      const attrCap = getNpcAttrCapByTier(currentTier);

      if (npcData.level % GameConfig.ApAcquisitionLevel === 0) {
        const pickedAttr = weightedPickNpcAttribute(
          initialAttributes,
          levelAttributeGain,
          milestoneAttributeGain,
          attrCap
        );
        if (pickedAttr) {
          levelAttributeGain[pickedAttr] += 1;
        }
      }

      const milestone = getMilestoneForLevel(npcData.level);
      if (milestone) {
        _.forEach(AttributeKeys, attrKey => {
          milestoneAttributeGain[attrKey] += milestone.attributes;
        });
      }

      const nextTier = getTierForLevel(npcData.level);
      if (previousTier !== nextTier) {
        levelUpPrompts.push(`${name}的生命层级从${previousTier}晋升到了${nextTier}`);
        previousTier = nextTier;
      }

      // 到达门槛等级时中断本轮升级，下一周期方可突破
      if (NPC_LEVEL_GATES.has(npcData.level)) {
        break;
      }
    }

    // 统一按“当前属性 + 本轮随机升级增量 + 本轮层级突破增量”回写，
    // 避免旧值初始化污染，同时保留玩家/外部对当前属性的自由调整。
    _.forEach(AttributeKeys, attrKey => {
      _.set(
        npc,
        `属性.${attrKey}`,
        initialAttributes[attrKey] + levelAttributeGain[attrKey] + milestoneAttributeGain[attrKey]
      );
    });

    // 同步升级后的等级回关系列表（使用 _.set 确保写入）
    if (npc.等级 < npcData.level) {
      levelUpPrompts.unshift(`${name}从LV${initialLevel}提升到LV${npcData.level}`);
      _.set(npc, '等级', npcData.level);
      // 同步生命层级
      _.set(npc, '生命层级', getTierForLevel(npcData.level));
    }
  });

  new_variables.date.npcs = dateNpcs;
  if (levelUpPrompts.length > 0) {
    new_variables.date.levelUpNpcs = levelUpPrompts;
  }
};
