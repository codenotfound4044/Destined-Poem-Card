import { klona } from 'klona';
import { onBeforeUnmount, watch } from 'vue';
/**
 * 开局草稿 Composable：恢复与自动保存
 */
import { useCharacterStore, useCustomContentStore } from '../store';
import {
  flushDraftSave,
  readDraft,
  isOpeningOnly,
  removeDraft,
  scheduleDraftSave,
  type StartDraft,
} from '../utils/draft';
import { applyPresetToStore, createPresetFromStore } from '../utils/preset-manager';
import { useStepNavigation } from './use-step-navigation';

interface UseDraftReturn {
  /** 有草稿时恢复到 store 并跳到保存时的步骤，返回是否恢复 */
  restoreDraft: () => boolean;
  /** 开始监听填写内容并自动保存 */
  startAutoSave: () => void;
}

export function useDraft(): UseDraftReturn {
  const characterStore = useCharacterStore();
  const customContentStore = useCustomContentStore();
  const { currentStep, goToStep } = useStepNavigation();

  const buildDraft = (): StartDraft => {
    const preset = createPresetFromStore(
      '草稿',
      characterStore,
      customContentStore.customInjectionSettings,
    );
    return {
      savedAt: Date.now(),
      step: currentStep.value,
      preset: { ...preset, character: { ...preset.character, name: '' } },
      customBackgroundDescription: customContentStore.customBackgroundDescription,
      customForms: {
        item: klona(customContentStore.customItemForm),
        editingItemName: customContentStore.editingCustomItemName,
        partner: klona(customContentStore.customPartnerForm),
        editingPartnerName: customContentStore.editingCustomPartnerName,
        editors: klona(customContentStore.editorDrafts),
      },
    };
  };

  const restoreDraft = (): boolean => {
    const draft = readDraft();
    if (!draft) return false;
    // 已经往下聊了：残留草稿没有用处，删掉，不恢复
    if (!isOpeningOnly()) {
      removeDraft();
      return false;
    }
    try {
      applyPresetToStore(draft.preset, characterStore, { silent: true });
      customContentStore.updateCustomBackgroundDescription(draft.customBackgroundDescription ?? '');
      customContentStore.setCustomInjectionSettings(draft.preset.customInjectionSettings);
      // 在空白表单上合并，旧草稿缺的字段保持默认值
      customContentStore.resetCustomItemForm();
      customContentStore.resetCustomPartnerForm();
      if (draft.customForms) {
        customContentStore.setCustomItemForm(draft.customForms.item ?? {});
        customContentStore.updateEditingCustomItemName(draft.customForms.editingItemName ?? '');
        customContentStore.setCustomPartnerForm(draft.customForms.partner ?? {});
        customContentStore.updateEditingCustomPartnerName(
          draft.customForms.editingPartnerName ?? '',
        );
        customContentStore.restoreEditorDrafts(draft.customForms.editors ?? {});
      }
      goToStep(_.isNumber(draft.step) ? draft.step : 1);
      toastr.info('已恢复上次未完成的开局填写');
      return true;
    } catch (error) {
      console.warn('恢复开局草稿失败，已丢弃草稿:', error);
      characterStore.resetCharacter();
      characterStore.clearAllSelections();
      customContentStore.resetAll();
      removeDraft();
      return false;
    }
  };

  // 姓名随人设变化，不计入草稿内容
  const draftSnapshot = () =>
    JSON.stringify([
      _.omit(characterStore.character, 'name'),
      characterStore.selectedEquipments,
      characterStore.selectedItems,
      characterStore.selectedAssets,
      characterStore.selectedSkills,
      characterStore.selectedPartners,
      characterStore.selectedBackground,
      customContentStore.customBackgroundDescription,
      customContentStore.customInjectionSettings,
      customContentStore.customItemForm,
      customContentStore.editingCustomItemName,
      customContentStore.customPartnerForm,
      customContentStore.editingCustomPartnerName,
      customContentStore.editorDrafts,
      currentStep.value,
    ]);

  // iframe 被酒馆重新渲染时，把还没写入的草稿立即写入
  const handlePageHide = () => flushDraftSave();

  const startAutoSave = () => {
    if (!isOpeningOnly()) return;
    watch(draftSnapshot, () => scheduleDraftSave(buildDraft));
    window.addEventListener('pagehide', handlePageHide);
  };

  onBeforeUnmount(() => {
    window.removeEventListener('pagehide', handlePageHide);
    flushDraftSave();
  });

  return { restoreDraft, startAutoSave };
}
