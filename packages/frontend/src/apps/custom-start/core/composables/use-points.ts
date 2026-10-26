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

  // 判断是否可以 Roll 点数（只有在没有消耗点数时才允许；天赋可以选回「未选择」退还消耗）
  const canRollPoints = computed(() => {
    return characterStore.consumedPoints === 0;
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
