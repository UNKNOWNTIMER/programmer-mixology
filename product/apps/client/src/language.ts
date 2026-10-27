export type Language = 'zh' | 'en';

export const DEFAULT_LANGUAGE: Language = 'en';

/** Keep an explicit supported preference; new and legacy missing values use English. */
export function normalizeLanguage(value: unknown): Language {
  return value === 'zh' || value === 'en' ? value : DEFAULT_LANGUAGE;
}
