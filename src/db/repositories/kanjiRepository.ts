import { db } from '../schema';
import { CONTENT_ALIAS as C } from '../contentDb';
import { FuriganaChunk, ExampleSentence } from '../../hooks/useReviewSession';

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export interface RelatedWord {
  id: string;
  expression: string;
  reading: string;
  furigana: FuriganaChunk[];
  gloss: string;
}

export interface RelatedExample {
  id: number;
  jp: string;
  en: string;
  furigana: FuriganaChunk[];
}

/**
 * 取得包含該漢字的單字清單
 */
export const getKanjiWords = (char: string, limit: number = 10): RelatedWord[] => {
  const rows = (db.executeSync(
    `SELECT v.id, v.expression, v.reading, v.furigana, v.gloss
     FROM ${C}.vocab v
     JOIN ${C}.vocab_kanji vk ON v.id = vk.vocab_id
     WHERE vk.char = ?
     LIMIT ?`,
    [char, limit]
  ).rows ?? []) as any[];

  return rows.map((r) => ({
    id: r.id,
    expression: r.expression,
    reading: r.reading,
    furigana: parseJson<FuriganaChunk[]>(r.furigana, [{ ruby: r.expression }]),
    gloss: r.gloss,
  }));
};

/**
 * 取得包含該漢字的例句清單
 */
export const getKanjiExamples = (char: string, limit: number = 10): RelatedExample[] => {
  // 直接使用 LIKE 查詢例句日文包含該漢字
  const rows = (db.executeSync(
    `SELECT e.id, e.jp, e.en, e.furigana
     FROM ${C}.example e
     WHERE e.jp LIKE ?
     LIMIT ?`,
    [`%${char}%`, limit]
  ).rows ?? []) as any[];

  return rows.map((r) => ({
    id: r.id,
    jp: r.jp,
    en: r.en,
    furigana: parseJson<FuriganaChunk[]>(r.furigana, [{ ruby: r.jp }]),
  }));
};
