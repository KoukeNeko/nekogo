/**
 * buildTrainingItems 的獨立驗證（以 Node --experimental-strip-types 執行）。
 * 不依賴 React Native，純驗證 revlog → 訓練輸入的轉換邏輯。
 */
import { buildTrainingItems, type RevlogRow } from '../src/services/fsrsTraining.ts';

let failures = 0;
const check = (name: string, condition: boolean) => {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name}`);
    failures += 1;
  }
};

const DAY = 86_400_000;
const base = 1_700_000_000_000;

// 1) 空輸入
check('空輸入 → 空陣列', buildTrainingItems([]).length === 0);

// 2) 分組 + 排序 + deltaT
const rows: RevlogRow[] = [
  { card_id: 'a', rating: 3, review_time: base + 2 * DAY }, // 故意亂序
  { card_id: 'a', rating: 3, review_time: base },
  { card_id: 'a', rating: 4, review_time: base + 5 * DAY },
  { card_id: 'b', rating: 2, review_time: base },
  { card_id: 'b', rating: 3, review_time: base + DAY },
  { card_id: 'e', rating: 3, review_time: base }, // 只複習一次 → 應被過濾
];
const items = buildTrainingItems(rows);
check('兩張有效卡 → 兩個 item（單筆卡 e 被過濾）', items.length === 2);
check('沒有單筆複習的 item 殘留', !items.some((it) => it.reviews.length === 1));

const a = items.find((it) => it.reviews.length === 3)!;
check('卡 a 有 3 筆', a?.reviews.length === 3);
check('首筆 deltaT = 0', a?.reviews[0].deltaT === 0);
check('第二筆 deltaT = 2（依時間排序後）', a?.reviews[1].deltaT === 2);
check('第三筆 deltaT = 3（5-2）', a?.reviews[2].deltaT === 3);
check('rating 保留正確', a?.reviews[2].rating === 4);

// 3) 過濾非 1-4 評分
const filtered = buildTrainingItems([
  { card_id: 'c', rating: 0, review_time: base },
  { card_id: 'c', rating: 5, review_time: base + DAY },
]);
check('評分皆非 1-4 → 不產生 item', filtered.length === 0);

// 4) 半天進位
const halfDay = buildTrainingItems([
  { card_id: 'd', rating: 3, review_time: base },
  { card_id: 'd', rating: 3, review_time: base + Math.round(1.6 * DAY) },
]);
check('1.6 天 → deltaT 進位為 2', halfDay[0].reviews[1].deltaT === 2);

if (failures === 0) {
  console.log('\nALL PASS');
} else {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
