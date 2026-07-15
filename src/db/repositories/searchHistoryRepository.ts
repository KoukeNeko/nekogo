import { db } from '../schema';

/** 搜尋紀錄（存主庫 search_history，query 主鍵去重、依最近搜尋時間排序）。 */

const MAX_HISTORY_ENTRIES = 20;

export const addSearchHistory = (query: string): void => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;
  try {
    db.executeSync(
      `INSERT INTO search_history (query, searched_at) VALUES (?, ?)
       ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at`,
      [normalizedQuery, Date.now()],
    );
    // 修剪超出保留上限的最舊紀錄。
    db.executeSync(
      `DELETE FROM search_history WHERE query NOT IN (
         SELECT query FROM search_history ORDER BY searched_at DESC LIMIT ?
       )`,
      [MAX_HISTORY_ENTRIES],
    );
  } catch (error) {
    console.error('寫入搜尋紀錄失敗', error);
  }
};

export const getSearchHistory = (limit: number = MAX_HISTORY_ENTRIES): string[] => {
  try {
    const rows =
      db.executeSync('SELECT query FROM search_history ORDER BY searched_at DESC LIMIT ?', [limit])
        .rows ?? [];
    return rows.map((row: any) => row.query as string);
  } catch (error) {
    console.error('讀取搜尋紀錄失敗', error);
    return [];
  }
};

export const removeSearchHistory = (query: string): void => {
  try {
    db.executeSync('DELETE FROM search_history WHERE query = ?', [query]);
  } catch (error) {
    console.error('刪除搜尋紀錄失敗', error);
  }
};

export const clearSearchHistory = (): void => {
  try {
    db.executeSync('DELETE FROM search_history');
  } catch (error) {
    console.error('清空搜尋紀錄失敗', error);
  }
};
