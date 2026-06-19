import { db } from '../schema';

const FSRS_PARAMS_KEY = 'fsrs_params';

/** 讀本機已訓練的 FSRS 參數（w）；無或無效時回 null。 */
export const getStoredParameters = (): number[] | null => {
  const row = db.executeSync('SELECT value FROM kv WHERE key = ?', [FSRS_PARAMS_KEY]).rows?.[0] as
    | { value?: string }
    | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((n) => typeof n === 'number')
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
};

/** 存訓練出的 FSRS 參數（w）。 */
export const storeParameters = (weights: number[]): void => {
  db.executeSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [
    FSRS_PARAMS_KEY,
    JSON.stringify(weights),
  ]);
};

/** 清除已訓練的參數（回到預設）。 */
export const clearStoredParameters = (): void => {
  db.executeSync('DELETE FROM kv WHERE key = ?', [FSRS_PARAMS_KEY]);
};

/** 本機累積的複習紀錄筆數（最適化資料量門檻用）。 */
export const getRevlogCount = (): number => {
  const row = db.executeSync('SELECT COUNT(*) AS c FROM revlog').rows?.[0] as { c?: number } | undefined;
  return row?.c ?? 0;
};
