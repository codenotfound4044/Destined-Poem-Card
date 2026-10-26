import { computed, type ComputedRef } from 'vue';
/**
 * 转生点数管理 Composable
 */
import { storeToRefs } from 'pinia';

import { useCharacterStore } from '../store';

interface UsePointsReturn {
  /** 可用点数 */
  availablePoints: ComputedRef<number>;
  /** 是否可以 Roll 点数 */
  canRollPoints: ComputedRef<boolean>;
  /** Roll 新的转生点数 */
  rollPoints: () => number;
}

/**
 * 使用转生点数管理
 */
export function usePoints(): UsePointsReturn {
  const characterStore = useCharacterStore();
  const { character } = storeToRefs(characterStore);

  // 计算可用点数
  const availablePoints = computed(() => {
    const consumed = characterStore.consumedPoints;
    return character.value.reincarnationPoints - consumed;
  });

  // 判断是否可以 Roll 点数：除天赋外没有消耗点数时才允许。
  // 天赋必选且不能取消，计入的话选过天赋就再也无法 Roll。
  const canRollPoints = computed(() => {
    const talentCost = characterStore.selectedTalent?.cost ?? 0;
    return characterStore.consumedPoints - talentCost === 0;
  });

  // Roll 转生点数
  const rollPoints = () => {
    return characterStore.rollInitialPoints();
  };

  return {
    availablePoints,
    canRollPoints,
    rollPoints,
  };
}
