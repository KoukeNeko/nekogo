/**
 * 把本機 revlog 轉成 fsrs-rs 訓練輸入。
 *
 * fsrs 的 `FSRSReview` 需要 { rating(1-4), deltaT(距上次複習天數，每張卡首筆為 0) }，
 * 並以「每張卡一個 FSRSItem、reviews 依時間排序」的形式餵入 optimizer。
 *
 * 純函式、無 React Native 依賴，便於以 Node 單獨測試。
 */

const DAY_MS = 86_400_000;

/** FSRS 參數最佳化的建議最低複習筆數（資料太少訓練無意義；fsrs <64 筆不會真正訓練）。 */
export const MIN_REVIEWS_TO_OPTIMIZE = 1000;

export interface RevlogRow {
  card_id: string;
  rating: number;
  review_time: number; // epoch ms
}

export interface TrainingReview {
  rating: number;
  deltaT: number;
}

export interface TrainingItem {
  reviews: TrainingReview[];
}

/**
 * revlog 列 → 訓練 items。依 card_id 分組、依 review_time 排序；
 * deltaT 為相鄰兩次複習的天數（四捨五入），每張卡第一筆固定為 0。
 * 只取評分 1–4（略過 ts-fsrs 的 Manual=0 等非評分紀錄）。
 */
export const buildTrainingItems = (rows: RevlogRow[]): TrainingItem[] => {
  const byCard = new Map<string, RevlogRow[]>();
  for (const row of rows) {
    if (row.rating < 1 || row.rating > 4) continue;
    const list = byCard.get(row.card_id);
    if (list) {
      list.push(row);
    } else {
      byCard.set(row.card_id, [row]);
    }
  }

  const items: TrainingItem[] = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.review_time - b.review_time);
    const reviews: TrainingReview[] = [];
    let previousTime: number | null = null;
    for (const row of list) {
      const deltaT =
        previousTime === null ? 0 : Math.max(0, Math.round((row.review_time - previousTime) / DAY_MS));
      reviews.push({ rating: row.rating, deltaT });
      previousTime = row.review_time;
    }
    // 至少要有一筆有間隔的複習（fsrs 要求每張卡 delta_t>0，否則會 panic；
    // 只複習一次的卡也無訓練價值）。
    if (reviews.some((review) => review.deltaT > 0)) {
      items.push({ reviews });
    }
  }
  return items;
};
