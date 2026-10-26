import { dataUrl } from '@/shared/cdn';
import { fetchWithRetry } from '@/shared/fetch-retry';

export interface AgreementSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface AgreementDocument {
  version: string;
  title: string;
  sections: AgreementSection[];
}

export const AGREEMENT_STORAGE_KEY = 'destined-journey-agreement-version';

const AGREEMENT_URL = dataUrl('agreement.json');

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isAgreementDocument(value: unknown): value is AgreementDocument {
  if (!value || typeof value !== 'object') return false;

  const document = value as Partial<AgreementDocument>;
  return (
    typeof document.version === 'string' &&
    document.version.trim().length > 0 &&
    typeof document.title === 'string' &&
    document.title.trim().length > 0 &&
    Array.isArray(document.sections) &&
    document.sections.length > 0 &&
    document.sections.every(section => {
      if (!section || typeof section !== 'object') return false;
      const candidate = section as AgreementSection;
      return (
        typeof candidate.title === 'string' &&
        candidate.title.trim().length > 0 &&
        (candidate.paragraphs === undefined || isStringArray(candidate.paragraphs)) &&
        (candidate.items === undefined || isStringArray(candidate.items))
      );
    })
  );
}

/** 从当前发布资源读取用户协议；保留按协议版本确认和无缓存请求的行为。 */
export async function loadAgreement(): Promise<AgreementDocument> {
  const response = await fetchWithRetry(`${AGREEMENT_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`协议加载失败 (${response.status})`);
  }

  const data: unknown = await response.json();
  if (!isAgreementDocument(data)) {
    throw new Error('线上协议格式无效');
  }

  return data;
}

export function hasAcceptedAgreement(version: string): boolean {
  try {
    return localStorage.getItem(AGREEMENT_STORAGE_KEY) === version;
  } catch {
    return false;
  }
}

export function saveAcceptedAgreement(version: string): void {
  try {
    localStorage.setItem(AGREEMENT_STORAGE_KEY, version);
  } catch {
    // localStorage 不可用时仅维持当前会话状态。
  }
}
