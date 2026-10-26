import type { Attributes, EquipmentItem, SkillItem } from '../types/editors';
import { klona } from 'klona';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { DEFAULT_CUSTOM_INJECTION_SETTINGS } from '../data/constants';
import type { CustomInjectionSettings, CustomInternalAsset, Rarity } from '../types';

/** 自定义物品表单的空白值 */
export const createEmptyCustomItemForm = () => ({
  categoryType: 'equipment' as 'equipment' | 'item' | 'asset' | 'skill',
  customItemType: '',
  itemName: '',
  itemRarity: 'common' as Rarity,
  itemTag: [] as string[],
  itemEffect: {} as Record<string, string>,
  itemDescription: '',
  itemConsume: '',
  itemSettlement: '',
  itemSpace: '',
  itemLocation: '',
  internalAssets: [] as Array<CustomInternalAsset & { name: string }>,
  itemQuantity: 1,
});

export type CustomItemFormData = ReturnType<typeof createEmptyCustomItemForm>;

/** 伙伴属性默认值 */
const defaultAttributes: Attributes = {
  strength: 5,
  dexterity: 5,
  constitution: 5,
  intelligence: 5,
  mind: 5,
};

/** 自定义伙伴表单的空白值（数组用于多值字段，对象用于复杂结构） */
export const createEmptyCustomPartnerForm = () => ({
  itemName: '',
  itemLevel: 1,
  itemLifeLevel: '',
  itemGrade: 1,
  itemRace: '',
  itemIdentity: [] as string[],
  itemCareer: [] as string[],
  itemPersonality: '',
  itemLike: '',
  itemApp: '',
  itemCloth: '',
  itemEquip: [] as EquipmentItem[],
  itemAttributes: klona(defaultAttributes),
  itemStairway: '',
  itemIsContract: true,
  itemAffinity: 0,
  itemComment: '',
  itemBackgroundInfo: '',
  itemSkills: [] as SkillItem[],
});

export type CustomPartnerFormData = ReturnType<typeof createEmptyCustomPartnerForm>;

/** 表单是否填过内容（物品类别只是切换标签，不算内容） */
export const hasCustomItemFormContent = (form: CustomItemFormData) =>
  !_.isEqual(_.omit(form, 'categoryType'), _.omit(createEmptyCustomItemForm(), 'categoryType'));

/** 生命层级由等级自动推出，表单挂载时就会填上，不算内容 */
export const hasCustomPartnerFormContent = (form: CustomPartnerFormData) =>
  !_.isEqual(
    _.omit(form, 'itemLifeLevel'),
    _.omit(createEmptyCustomPartnerForm(), 'itemLifeLevel'),
  );

/** 各暂存键的初始值工厂，重置时使用 */
const editorDraftInitials = new Map<string, () => unknown>();
/** 各暂存键当前所属的组件实例（卸载回调晚于新组件挂载，只有所有者能删除） */
const editorDraftOwners = new Map<string, symbol>();

/**
 * 自定义内容 Store
 * 管理所有用户自定义输入的内容，实现跨页面状态持久化
 */
export const useCustomContentStore = defineStore('customContent', () => {
  /**
   * 自定义开局剧情描述
   */
  const customBackgroundDescription = ref('');

  /**
   * 已选装备、道具、资产、技能、伙伴是否在开局时直接写入变量
   */
  const customInjectionSettings = ref<CustomInjectionSettings>({
    ...DEFAULT_CUSTOM_INJECTION_SETTINGS,
  });

  /**
   * 编辑器里尚未提交的输入（按 key 区分，见 useDraftSlot），随开局草稿保存。
   * 组件通过 toRef 引用其中的键，只能原地增删，不能整体替换。
   * 生命周期跟组件一致：组件卸载时删除，和原来的局部 ref 相同。
   */
  const editorDrafts = ref<Record<string, unknown>>({});

  /** 恢复草稿中的编辑器暂存内容（页面组件创建前调用） */
  const restoreEditorDrafts = (value: Record<string, unknown>) => {
    _.forEach(_.keys(editorDrafts.value), key => delete editorDrafts.value[key]);
    editorDraftOwners.clear();
    _.assign(editorDrafts.value, value);
  };

  /**
   * 组件创建时登记暂存键。草稿恢复出的值（还没有所有者）由第一个组件接手；
   * 键仍属于别的组件时视为新的输入框，从初始值开始，与原来的局部 ref 一致。
   */
  const ensureEditorDraft = (key: string, initial: () => unknown, owner: symbol) => {
    editorDraftInitials.set(key, initial);
    if (!_.has(editorDrafts.value, [key]) || editorDraftOwners.has(key)) {
      editorDrafts.value[key] = initial();
    }
    editorDraftOwners.set(key, owner);
  };

  /** 组件卸载时删除暂存键（键已被新组件接手时不删） */
  const releaseEditorDraft = (key: string, owner: symbol) => {
    if (editorDraftOwners.get(key) !== owner) return;
    editorDraftOwners.delete(key);
    delete editorDrafts.value[key];
  };

  /** 表单重置或回填另一条目时，把该表单下的暂存恢复为初始值 */
  const resetEditorDrafts = (prefix: string) => {
    _.forEach(_.keys(editorDrafts.value), key => {
      if (!key.startsWith(prefix)) return;
      const initial = editorDraftInitials.get(key);
      if (initial) {
        editorDrafts.value[key] = initial();
      } else {
        delete editorDrafts.value[key];
      }
    });
  };

  /**
   * 自定义物品编辑标识
   */
  const editingCustomItemName = ref('');

  /**
   * 自定义伙伴编辑标识
   */
  const editingCustomPartnerName = ref('');

  /**
   * 更新自定义开局描述
   */
  const updateCustomBackgroundDescription = (value: string) => {
    customBackgroundDescription.value = value;
  };

  const updateCustomInjectionSetting = (
    category: keyof CustomInjectionSettings,
    value: boolean,
  ) => {
    customInjectionSettings.value[category] = value;
  };

  const setCustomInjectionSettings = (value?: Partial<CustomInjectionSettings>) => {
    customInjectionSettings.value = {
      ...DEFAULT_CUSTOM_INJECTION_SETTINGS,
      ...value,
    };
  };

  /**
   * 自定义物品表单数据
   */
  const customItemForm = ref(createEmptyCustomItemForm());

  /**
   * 更新自定义物品表单
   */
  const updateCustomItemForm = (field: keyof typeof customItemForm.value, value: any) => {
    customItemForm.value[field] = value as never;
  };

  /**
   * 批量设置自定义物品表单
   */
  const setCustomItemForm = (value: Partial<typeof customItemForm.value>) => {
    customItemForm.value = {
      ...customItemForm.value,
      ...value,
    };
  };

  /**
   * 更新自定义物品编辑标识
   */
  const updateEditingCustomItemName = (value: string) => {
    editingCustomItemName.value = value;
  };

  /**
   * 重置自定义物品表单
   */
  const resetCustomItemForm = () => {
    customItemForm.value = createEmptyCustomItemForm();
    editingCustomItemName.value = '';
    resetEditorDrafts('item.');
  };

  /**
   * 自定义伙伴表单数据
   * 使用专业级数据结构：数组用于多值字段，对象用于复杂结构
   */
  const customPartnerForm = ref(createEmptyCustomPartnerForm());

  /**
   * 更新自定义伙伴表单
   */
  const updateCustomPartnerForm = (field: keyof typeof customPartnerForm.value, value: any) => {
    customPartnerForm.value[field] = value as never;
  };

  /**
   * 批量设置自定义伙伴表单
   */
  const setCustomPartnerForm = (value: Partial<typeof customPartnerForm.value>) => {
    customPartnerForm.value = {
      ...customPartnerForm.value,
      ...value,
    };
  };

  /**
   * 更新自定义伙伴编辑标识
   */
  const updateEditingCustomPartnerName = (value: string) => {
    editingCustomPartnerName.value = value;
  };

  /**
   * 重置自定义伙伴表单
   * 使用 klona 确保深拷贝安全
   */
  const resetCustomPartnerForm = () => {
    customPartnerForm.value = createEmptyCustomPartnerForm();
    editingCustomPartnerName.value = '';
    resetEditorDrafts('partner.');
  };

  /**
   * 重置所有自定义内容
   */
  const resetAll = () => {
    customBackgroundDescription.value = '';
    setCustomInjectionSettings();
    resetCustomItemForm();
    resetCustomPartnerForm();
    editingCustomItemName.value = '';
    editingCustomPartnerName.value = '';
    restoreEditorDrafts({});
  };

  return {
    // 自定义开局描述
    customBackgroundDescription,
    updateCustomBackgroundDescription,
    customInjectionSettings,
    updateCustomInjectionSetting,
    setCustomInjectionSettings,

    // 自定义物品编辑标识
    editingCustomItemName,
    updateEditingCustomItemName,

    // 自定义伙伴编辑标识
    editingCustomPartnerName,
    updateEditingCustomPartnerName,

    // 自定义物品表单
    customItemForm,
    updateCustomItemForm,
    setCustomItemForm,
    resetCustomItemForm,

    // 自定义伙伴表单
    customPartnerForm,
    updateCustomPartnerForm,
    setCustomPartnerForm,
    resetCustomPartnerForm,

    // 编辑器暂存
    editorDrafts,
    restoreEditorDrafts,
    ensureEditorDraft,
    releaseEditorDraft,
    resetEditorDrafts,

    // 全局重置
    resetAll,
  };
});
