import { db } from '../schema';

/**
 * 智慧收藏（資料庫）資料層。內容文字由 UI 端以 fetchVocabByIds 自雲端取得；
 * 這裡只處理本機 cards 的篩選與旗標。
 */

export type CollectionKind = 'history' | 'difficult' | 'leech' | 'bookmark' | 'suspended';

// 門檻（皆可調）：FSRS difficulty 1–10，越高越難；lapses = 答錯/忘記次數。
const DIFFICULT_MIN = 7;
const LEECH_MIN_LAPSES = 4;

const whereClauseFor = (kind: CollectionKind): string => {
  switch (kind) {
    case 'history':
      return 'state > 0'; // 已開始學（有複習過）
    case 'difficult':
      return `state > 0 AND difficulty >= ${DIFFICULT_MIN}`;
    case 'leech':
      return `lapses >= ${LEECH_MIN_LAPSES}`;
    case 'bookmark':
      return 'bookmarked = 1';
    case 'suspended':
      return 'suspended = 1';
  }
};

const orderClauseFor = (kind: CollectionKind): string => {
  switch (kind) {
    case 'difficult':
      return 'ORDER BY difficulty DESC';
    case 'leech':
      return 'ORDER BY lapses DESC';
    default:
      return 'ORDER BY last_review DESC, intro_rank IS NULL, intro_rank ASC';
  }
};

const countWhere = (where: string): number =>
  (db.executeSync(`SELECT COUNT(*) AS c FROM cards WHERE ${where}`).rows[0] as { c?: number } | undefined)?.c ?? 0;

/** 各收藏的數量（給清單頁右側數字）。 */
export const getCollectionCounts = (): Record<CollectionKind, number> => ({
  history: countWhere(whereClauseFor('history')),
  bookmark: countWhere(whereClauseFor('bookmark')),
  suspended: countWhere(whereClauseFor('suspended')),
  leech: countWhere(whereClauseFor('leech')),
  difficult: countWhere(whereClauseFor('difficult')),
});

/** 某收藏的 vocab_id 清單（UI 再用 fetchVocabByIds 抓內容渲染）。 */
export const getCollectionVocabIds = (kind: CollectionKind, limit = 500): string[] => {
  const rows = (db.executeSync(
    `SELECT vocab_id FROM cards WHERE ${whereClauseFor(kind)} ${orderClauseFor(kind)} LIMIT ?`,
    [limit],
  ).rows ?? []) as { vocab_id: string }[];
  return rows.map((row) => row.vocab_id);
};

/** 目前卡片的旗標狀態（複習頁顯示書籤/隱藏鈕的 on/off）。 */
export const getCardFlags = (vocabId: string): { bookmarked: boolean; suspended: boolean } => {
  const row = db.executeSync('SELECT bookmarked, suspended FROM cards WHERE vocab_id = ?', [vocabId]).rows?.[0] as
    | { bookmarked?: number; suspended?: number }
    | undefined;
  return { bookmarked: !!row?.bookmarked, suspended: !!row?.suspended };
};

export const setBookmarked = (vocabId: string, value: boolean): void => {
  db.executeSync('UPDATE cards SET bookmarked = ? WHERE vocab_id = ?', [value ? 1 : 0, vocabId]);
};

/** 隱藏的卡會被 getDueCards / getDailyMetrics 排除，不再出現於複習。 */
export const setSuspended = (vocabId: string, value: boolean): void => {
  db.executeSync('UPDATE cards SET suspended = ? WHERE vocab_id = ?', [value ? 1 : 0, vocabId]);
};
