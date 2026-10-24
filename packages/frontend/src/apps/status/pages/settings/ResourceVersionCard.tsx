import { FC, useState } from 'react';
import { Card } from '../../shared/components';
import styles from './SettingsTab.module.scss';

/** 角色变量名：卡内加载器按这里的版本号加载各组脚本（见 tools/lib/resource-loader.mjs）。 */
const VARIABLE = '资源版本';
const LOADED_PREFIX = 'destiny:loaded:';
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/i;
const DESCRIPTIONS: Record<string, string> = {
  命定之诗: '首页、状态栏、自定义开局、自动化和地理数据',
  创意工坊: '创意工坊脚本',
  自动正则: '自动正则（对话美化）脚本',
  角色管理库: '角色管理库脚本',
};

interface Loaded {
  version: string;
  defaultVersion: string;
}

function readVersions(): Record<string, string> {
  try {
    const value = getVariables({ type: 'character' })[VARIABLE];
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, version]) => [
        key,
        typeof version === 'string' ? version : '',
      ]),
    );
  } catch (error) {
    console.error('[StatusBar] 读取资源版本失败:', error);
    return {};
  }
}

function readLoaded(key: string): Loaded | null {
  try {
    const raw = sessionStorage.getItem(LOADED_PREFIX + key);
    return raw ? (JSON.parse(raw) as Loaded) : null;
  } catch {
    return null;
  }
}

/**
 * 脚本版本设置：改角色变量「资源版本」，刷新酒馆页面后由卡内加载器按新版本加载。
 * 填空表示用卡内默认版本；填的版本加载不到时加载器也会自动退回默认版本。
 */
export const ResourceVersionCard: FC = () => {
  const [draft, setDraft] = useState(readVersions);
  const keys = Object.keys(draft);
  if (!keys.length) return null;

  const invalid = keys.filter(key => draft[key].trim() && !VERSION_PATTERN.test(draft[key].trim()));

  const save = async (next: Record<string, string>) => {
    try {
      await insertOrAssignVariables({ [VARIABLE]: next }, { type: 'character' });
      setDraft(next);
      toastr.success('已保存，刷新酒馆页面后生效');
    } catch (error) {
      console.error('[StatusBar] 保存资源版本失败:', error);
      toastr.error('保存失败，请稍后再试');
    }
  };
  const handleSave = () => {
    if (invalid.length) {
      toastr.warning(`版本号格式应为 主.次.补丁，比如 1.0.1：${invalid.join('、')}`);
      return;
    }
    save(Object.fromEntries(keys.map(key => [key, draft[key].trim().replace(/^v/i, '')])));
  };
  const handleReset = () => {
    // 默认版本以本次实际加载时记下的为准；没记录的留空，加载器同样会用卡内默认版本。
    save(Object.fromEntries(keys.map(key => [key, readLoaded(key)?.defaultVersion ?? ''])));
  };

  return (
    <Card title="脚本版本" className={styles.settingsTabTheme}>
      <div className={styles.uniqueColorDescription}>
        群里或帖子说某个脚本更新到新版本时，在这里改版本号，保存后刷新酒馆页面生效。留空就用卡内默认版本；填的版本加载不到时也会自动用回默认版本。
      </div>
      <div className={styles.versionList}>
        {keys.map(key => {
          const loaded = readLoaded(key);
          const status = !loaded
            ? '这次没有记录到加载信息'
            : loaded.version
              ? `当前加载 ${loaded.version}${loaded.version === loaded.defaultVersion ? '（卡内默认）' : `，卡内默认 ${loaded.defaultVersion}`}`
              : '正在使用本机开发资源，不读取这里的版本';
          return (
            <label key={key} className={styles.versionRow}>
              <span className={styles.versionInfo}>
                <span className={styles.versionName}>{key}</span>
                <span className={styles.uniqueColorDescription}>
                  {DESCRIPTIONS[key] ?? '脚本'} · {status}
                </span>
              </span>
              <input
                className={`${styles.versionInput} ${invalid.includes(key) ? styles.versionInputInvalid : ''}`}
                value={draft[key]}
                placeholder={loaded?.defaultVersion || '卡内默认'}
                onChange={event => setDraft({ ...draft, [key]: event.target.value })}
                aria-label={`${key} 版本号`}
              />
            </label>
          );
        })}
      </div>
      <div className={styles.themeActions}>
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handleReset}>
          恢复默认
        </button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
          保存版本
        </button>
      </div>
    </Card>
  );
};
