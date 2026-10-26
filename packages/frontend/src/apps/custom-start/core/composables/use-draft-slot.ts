import { onUnmounted, ref, toRef, type Ref } from 'vue';
import { useCustomContentStore } from '../store/customContent';

/**
 * 组件内尚未提交的输入（例如编辑器里正在新增、还没点「添加」的条目）。
 * 传入 key 时存进 store 的暂存区，随开局草稿保存和恢复；不传 key 时等同普通 ref。
 * 组件卸载时删除对应的键，行为和原来的局部 ref 一致；页面被酒馆重新渲染时组件不会正常卸载，草稿得以保留。
 * key 按字面使用，可以包含点号。
 */
export function useDraftSlot<T>(key: string | undefined, initial: () => T): Ref<T> {
  if (!key) return ref(initial()) as Ref<T>;
  const store = useCustomContentStore();
  const owner = Symbol(key);
  store.ensureEditorDraft(key, initial, owner);
  onUnmounted(() => store.releaseEditorDraft(key, owner));
  return toRef(store.editorDrafts, key) as Ref<T>;
}
