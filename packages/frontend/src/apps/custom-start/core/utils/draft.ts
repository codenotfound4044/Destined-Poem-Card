import type { CustomItemFormData, CustomPartnerFormData } from '../store/customContent';
import type { CharacterPreset } from './preset-manager';

/**
 * 开局草稿：填写进度存进当前聊天的聊天变量，页面重新载入（例如切换人设）后恢复。
 * 只属于当前聊天，开局提交成功后删除。姓名不存，恢复时重新读人设。
 */
const DRAFT_KEY = 'custom_start_draft';

/** 停止输入后多久写入一次（每次写入都会保存聊天文件） */
const SAVE_DELAY_MS = 800;

export interface StartDraft {
  savedAt: number;
  /** 当前步骤（1-based） */
  step: number;
  /** 与预设相同的结构，恢复时复用预设读取逻辑 */
  preset: CharacterPreset;
  /** 自定义开局描述（可能在选中自定义背景之前就已填写） */
  customBackgroundDescription: string;
  /** 还没加入列表的自定义物品、伙伴表单，以及正在编辑的条目名 */
  customForms?: {
    item: CustomItemFormData;
    editingItemName: string;
    partner: CustomPartnerFormData;
    editingPartnerName: string;
    /** 编辑器里还没点「添加/保存」的输入（装备、技能、标签、效果等） */
    editors?: Record<string, unknown>;
  };
}

/** 开局已提交后不再写草稿，防止排队中的保存把草稿写回来 */
let finished = false;

export function readDraft(): StartDraft | null {
  try {
    const draft = _.get(getVariables({ type: 'chat' }), DRAFT_KEY);
    if (_.isPlainObject(draft) && _.isPlainObject(_.get(draft, 'preset.character'))) {
      return draft as StartDraft;
    }
  } catch (error) {
    console.warn('读取开局草稿失败:', error);
  }
  return null;
}

function writeDraft(draft: StartDraft): void {
  if (finished) return;
  try {
    // 整体替换，不与旧草稿合并（合并会让删掉的数组项残留）
    updateVariablesWith(
      variables => {
        variables[DRAFT_KEY] = draft;
        return variables;
      },
      { type: 'chat' },
    );
  } catch (error) {
    console.warn('保存开局草稿失败:', error);
  }
}

let pendingBuild: (() => StartDraft) | null = null;

/**
 * 聊天里是否只有开场白。草稿只在这时启用；已经往下聊了（例如没走开局直接聊天），
 * 草稿就没有用处，重新进入聊天时也不该再弹出恢复。
 */
export function isOpeningOnly(): boolean {
  try {
    return getLastMessageId() === 0;
  } catch {
    return false;
  }
}

const flushPending = () => {
  if (!pendingBuild) return;
  const build = pendingBuild;
  pendingBuild = null;
  // 页面打开期间聊天已往下走：删掉草稿并停止保存
  if (!isOpeningOnly()) {
    finished = true;
    removeDraft();
    return;
  }
  writeDraft(build());
};

const debouncedFlush = _.debounce(flushPending, SAVE_DELAY_MS);

/** 安排一次草稿保存；短时间内多次调用只写最后一次 */
export function scheduleDraftSave(build: () => StartDraft): void {
  if (finished) return;
  pendingBuild = build;
  debouncedFlush();
}

/** 立即写入排队中的草稿（页面即将卸载时调用） */
export function flushDraftSave(): void {
  debouncedFlush.cancel();
  flushPending();
}

export function removeDraft(): void {
  try {
    updateVariablesWith(
      variables => {
        _.unset(variables, DRAFT_KEY);
        return variables;
      },
      { type: 'chat' },
    );
  } catch (error) {
    console.warn('删除开局草稿失败:', error);
  }
}

/** 开局提交成功：取消排队中的保存并删除草稿 */
export function finishDraft(): void {
  finished = true;
  debouncedFlush.cancel();
  pendingBuild = null;
  removeDraft();
}
