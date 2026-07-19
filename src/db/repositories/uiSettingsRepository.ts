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

/** FSRS 目標定着率（request_retention）。存主庫 kv；未設定時用 FSRS 慣例預設 0.9。 */
export const TARGET_RETENTION_OPTIONS = [0.8, 0.85, 0.9, 0.95] as const;
const TARGET_RETENTION_KEY = 'target_retention';
const DEFAULT_TARGET_RETENTION = 0.9;

export const getTargetRetention = (): number => {
  try {
    const row = db.executeSync('SELECT value FROM kv WHERE key = ?', [TARGET_RETENTION_KEY])
      .rows?.[0] as { value?: string } | undefined;
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_TARGET_RETENTION;
  } catch {
    return DEFAULT_TARGET_RETENTION;
  }
};

export const setTargetRetention = (retention: number): void => {
  db.executeSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [TARGET_RETENTION_KEY, String(retention)],
  );
};

/** 預產日文語音 API。空字串代表停用線上語音、只使用裝置 TTS。 */
export const DEFAULT_TTS_SERVER_URL =
  process.env.EXPO_PUBLIC_TTS_SERVER_URL?.trim() || 'http://192.168.50.169:8090';
const TTS_SERVER_URL_KEY = 'tts_server_url';

export const normalizeTtsServerUrl = (rawValue: string): string => {
  const value = rawValue.trim();
  if (!value) return '';

  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('音声サーバーは http:// または https:// で始めてください');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('音声サーバー URL に認証情報・クエリ・フラグメントは指定できません');
  }
  return parsed.toString().replace(/\/$/, '');
};

export const getTtsServerUrl = (): string => {
  try {
    const row = db.executeSync('SELECT value FROM kv WHERE key = ?', [TTS_SERVER_URL_KEY])
      .rows?.[0] as { value?: string } | undefined;
    if (row?.value === undefined) return DEFAULT_TTS_SERVER_URL;
    return normalizeTtsServerUrl(row.value);
  } catch {
    return DEFAULT_TTS_SERVER_URL;
  }
};

export const setTtsServerUrl = (url: string): string => {
  const normalized = normalizeTtsServerUrl(url);
  db.executeSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [TTS_SERVER_URL_KEY, normalized],
  );
  return normalized;
};
