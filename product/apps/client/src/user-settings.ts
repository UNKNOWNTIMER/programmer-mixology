import type { UserState } from './types';
import { DEFAULT_LANGUAGE, normalizeLanguage } from './language';

type Settings = UserState['settings'];

export const DEFAULT_UI_SETTINGS = Object.freeze({
  language: DEFAULT_LANGUAGE,
  fontScale: 1.25,
  reducedMotion: false,
  startupAnimation: true,
});

// Older backups can omit settings. Preserve explicit preferences while making
// their missing or malformed display fields behave like a fresh installation.
export function normalizeSettings(value: unknown): Settings {
  const saved = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Settings>
    : {};
  return {
    ...saved,
    language: normalizeLanguage(saved.language),
    fontScale: typeof saved.fontScale === 'number' && [1, 1.1, 1.25].includes(saved.fontScale)
      ? saved.fontScale : DEFAULT_UI_SETTINGS.fontScale,
    reducedMotion: typeof saved.reducedMotion === 'boolean'
      ? saved.reducedMotion : DEFAULT_UI_SETTINGS.reducedMotion,
    startupAnimation: typeof saved.startupAnimation === 'boolean'
      ? saved.startupAnimation : DEFAULT_UI_SETTINGS.startupAnimation,
  };
}
