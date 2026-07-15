import { db } from '../schema';

/** 翻譯顯示語言：繁體中文（缺譯時退回英文）或英文原文。存於主庫 kv。 */
export type TranslationLanguage = 'zh' | 'en';

const TRANSLATION_LANGUAGE_KEY = 'translation_language';
const DEFAULT_LANGUAGE: TranslationLanguage = 'zh';

export const getTranslationLanguage = (): TranslationLanguage => {
  try {
    const row = db.executeSync('SELECT value FROM kv WHERE key = ?', [TRANSLATION_LANGUAGE_KEY])
      .rows?.[0] as { value?: string } | undefined;
    return row?.value === 'en' ? 'en' : DEFAULT_LANGUAGE;
  } catch {
    // 首次啟動 kv 表尚未建立時走預設值。
    return DEFAULT_LANGUAGE;
  }
};

export const setTranslationLanguage = (language: TranslationLanguage): void => {
  db.executeSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [TRANSLATION_LANGUAGE_KEY, language],
  );
};

/** 每日新卡引入上限（速讀配額）。存主庫 kv；未設定時用預設 20。 */
export const DAILY_NEW_LIMIT_OPTIONS = [10, 20, 30, 50] as const;
const DAILY_NEW_LIMIT_KEY = 'daily_new_limit';
const DEFAULT_DAILY_NEW_LIMIT = 20;

export const getDailyNewLimit = (): number => {
  try {
    const row = db.executeSync('SELECT value FROM kv WHERE key = ?', [DAILY_NEW_LIMIT_KEY])
      .rows?.[0] as { value?: string } | undefined;
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_NEW_LIMIT;
  } catch {
    return DEFAULT_DAILY_NEW_LIMIT;
  }
};

export const setDailyNewLimit = (limit: number): void => {
  db.executeSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [DAILY_NEW_LIMIT_KEY, String(limit)],
  );
};
