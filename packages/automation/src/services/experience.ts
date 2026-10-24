/**
 * 玩家经验与升级服务
 */

import {
  AttributeKeys,
  GameConfig,
  getMilestoneForLevel,
  getRequiredXpForLevel,
  getTierForLevel,
  isMaxLevel,
} from '../config';
import type { MessageVariables } from '../types';
import { safeGet } from '../utils';
import { canBreakAscensionLevel } from './ascension';

/**
 * 处理玩家角色的经验与升级
 *
 * @param new_variables - 更新后的变量数据
 * @param old_variables - 更新前的变量数据（由 MVU 事件提供）
 */
export const processExperienceAndLevel = (
  new_variables: MessageVariables,
  old_variables: MessageVariables
): void => {
  const character = safeGet(new_variables, 'stat_data.主角', {} as any);
  const initialLevel = safeGet(old_variables, 'stat_data.主角.等级', character.等级);
  const initialAttributePoints = Number(character.属性点) || 0;
  let previousTier = safeGet(
    old_variables,
    'stat_data.主角.生命层级',
    getTierForLevel(initialLevel)
  );
  const initialAttributes = _.fromPairs(
    _.map(AttributeKeys, attrKey => [
      attrKey,
      Number(safeGet(character, `属性.${attrKey}`, 0)) || 0,
    ])
  ) as Record<(typeof AttributeKeys)[number], number>;

  let gainedAP = 0;
  const tierBreakthroughs: string[] = [];
  const milestoneAttributeGain = _.fromPairs(
    _.map(AttributeKeys, attrKey => [attrKey, 0])
  ) as Record<(typeof AttributeKeys)[number], number>;

  // 升级处理循环
  while (character.累计经验值 >= Number(character.升级所需经验) && !isMaxLevel(character.等级)) {
    const canBreak = canBreakAscensionLevel(character.等级, new_variables);
    if (!canBreak) {
      // 关键等级未满足条件时，强制清空超出的经验
      _.set(character, '累计经验值', Number(character.升级所需经验));
      break;
    }

    _.set(character, '等级', character.等级 + 1);
    _.set(character, '升级所需经验', getRequiredXpForLevel(character.等级));

    // 属性点获得
    if (character.等级 % GameConfig.ApAcquisitionLevel === 0) {
      gainedAP += 1;
    }

    // 里程碑加成
    const milestone = getMilestoneForLevel(character.等级);
    if (milestone) {
      _.forEach(AttributeKeys, attrKey => {
        milestoneAttributeGain[attrKey] += milestone.attributes;
      });

      _.set(character, '生命层级', milestone.tier);
      if (previousTier !== milestone.tier) {
        tierBreakthroughs.push(`{{user}}的生命层级从${previousTier}晋升到了${milestone.tier}`);
        previousTier = milestone.tier;
      }
    }
  }

  _.set(character, '属性点', initialAttributePoints + gainedAP);
  // 统一按“当前属性 + 本轮层级突破增量”回写，避免旧值初始化污染，
  // 同时保留玩家/外部对当前属性的自由调整。
  _.forEach(AttributeKeys, attrKey => {
    _.set(
      character,
      `属性.${attrKey}`,
      initialAttributes[attrKey] + milestoneAttributeGain[attrKey]
    );
  });
  _.set(character, '生命层级', getTierForLevel(character.等级));

  // 将升级提示存储到 date.levelUpCharacter，供后续注入使用
  if (character.等级 > initialLevel) {
    const levelUpPrompts: string[] = [
      `{{user}}的等级从${initialLevel}级提升到了${character.等级}级`,
    ];

    if (gainedAP > 0) {
      levelUpPrompts.push(`{{user}}升级了，获得了${gainedAP}点属性点。引导{{user}}使用属性点`);
    }

    if (tierBreakthroughs.length > 0) {
      levelUpPrompts.push(...tierBreakthroughs);
    }

    new_variables.date.levelUpCharacter = levelUpPrompts;
  }
};
