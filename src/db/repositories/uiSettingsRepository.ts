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
