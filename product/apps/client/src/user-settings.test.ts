import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_SETTINGS, normalizeSettings } from './user-settings';
import { normalizeLanguage } from './language';

describe('restored display preferences', () => {
  it('fills absent settings from older backups with English, 125% and full animation', () => {
    for (const value of [undefined, null, {}, [], 'legacy']) {
      expect(normalizeSettings(value)).toEqual(DEFAULT_UI_SETTINGS);
    }
    expect(normalizeSettings({ language: 'en', aiMode: true })).toEqual({
      ...DEFAULT_UI_SETTINGS, language: 'en', aiMode: true,
    });
  });

  it('preserves explicit smaller text and disabled animation choices without mutation', () => {
    for (const fontScale of [1, 1.1, 1.25]) {
      const saved = Object.freeze({ fontScale, reducedMotion: true, startupAnimation: false, language: 'zh' });
      expect(normalizeSettings(saved)).toEqual(saved);
      expect(normalizeSettings(saved)).not.toBe(saved);
    }
  });

  it('repairs malformed display fields independently of valid saved choices', () => {
    for (const fontScale of [0, -1, 2, NaN, Infinity, '1.25', null]) {
      expect(normalizeSettings({ fontScale, reducedMotion: true, startupAnimation: false })).toEqual({
        language: 'en', fontScale: 1.25, reducedMotion: true, startupAnimation: false,
      });
    }
    expect(normalizeSettings({ fontScale: 1.1, reducedMotion: 'true', startupAnimation: 0 })).toEqual({
      language: 'en', fontScale: 1.1, reducedMotion: false, startupAnimation: true,
    });
  });
  it('keeps supported language choices and repairs invalid or missing language independently', () => {
    for (const language of ['zh', 'en'] as const) {
      const saved = Object.freeze({ ...DEFAULT_UI_SETTINGS, language, aiMode: true });
      expect(normalizeSettings(saved)).toEqual(saved);
      expect(normalizeLanguage(language)).toBe(language);
    }
    for (const language of [undefined, null, '', 'fr', 'EN', 0, {}, []]) {
      const saved = { language, fontScale: 1.1, reducedMotion: true, startupAnimation: false, aiMode: true };
      const before = JSON.stringify(saved);
      expect(normalizeSettings(saved)).toEqual({ ...saved, language: 'en' });
      expect(normalizeLanguage(language)).toBe('en');
      expect(JSON.stringify(saved)).toBe(before);
    }
  });

});
