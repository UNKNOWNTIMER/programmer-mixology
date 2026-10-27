import manifest from '../package.json';
import type { Language } from './i18n';

/** Public identity. Legacy storage IDs and archive schemas remain stable. */
export const APP_NAME_ZH = '程序员调酒台';
export const APP_NAME_EN = 'Programmer Mixology';
export const APP_VERSION = manifest.version;
export const APP_DEVELOPER = 'UNKNOWNTIMER';
export const PROJECT_URL = 'https://github.com/UNKNOWNTIMER/programmer-mixology';
export const appName = (language: Language) => language === 'en' ? APP_NAME_EN : APP_NAME_ZH;
