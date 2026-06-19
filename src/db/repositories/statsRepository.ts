import { db } from '../schema';
import { getStreak, getStudyTimeStats } from './cardRepository';

const DAY_MS = 86400000;
const GRID_WEEKS = 12;
const GRID_DAYS = GRID_WEEKS * 7;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export interface Stats {
  streak: number;
  reviewsToday: number;
  retention: number | null; // 通過率（rating>=2 的比例），無複習時為 null
  next7: { label: string; count: number }[];
  next7Total: number;
  grid: number[][]; // 7 列(星期) × 12 欄(週)，值為強度 0-3
  maturity: { newC: number; learnC: number; youngC: number; matureC: number };
  studyTodayMs: number; // 今日學習總時長
  avgPerCardMs: number; // 整體每張平均耗時
  perLevel: { level: number; total: number; studied: number }[]; // 各 JLPT 級進度（N5→N1）
  goalTotal: number; // 記憶目標 = 牌組總卡數
  goalDone: number; // 記憶完成 = 熟成卡數
}

const startOfTodayMs = (): number => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const localDay = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const intensity = (count: number): number => (count === 0 ? 0 : count < 5 ? 1 : count < 15 ? 2 : 3);

export const getStats = (): Stats => {
  const today0 = startOfTodayMs();

  const reviewsToday =
    (db.executeSync(
      `SELECT COUNT(*) AS c FROM revlog WHERE date(review_time / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')`,
    ).rows[0] as any)?.c || 0;

  const ret = db.executeSync('SELECT SUM(CASE WHEN rating >= 2 THEN 1 ELSE 0 END) AS p, COUNT(*) AS t FROM revlog').rows[0] as any;
  const retention = ret && ret.t > 0 ? ret.p / ret.t : null;

  // 今後 7 日到期卡數（逾期併入今天）
  const dueRows = (db.executeSync('SELECT due FROM cards WHERE due < ?', [today0 + 7 * DAY_MS]).rows ?? []) as any[];
  const buckets = new Array(7).fill(0);
  for (const row of dueRows) {
    const offset = Math.max(0, Math.floor((row.due - today0) / DAY_MS));
    if (offset <= 6) buckets[offset] += 1;
  }
  const next7 = buckets.map((count, i) => ({ label: WEEKDAYS[new Date(today0 + i * DAY_MS).getDay()], count }));
  const next7Total = buckets.reduce((a, b) => a + b, 0);

  // 複習記錄熱力圖（近 12 週）
  const since = today0 - (GRID_DAYS - 1) * DAY_MS;
  const revRows = (db.executeSync(
    `SELECT date(review_time / 1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c FROM revlog WHERE review_time >= ? GROUP BY d`,
    [since],
  ).rows ?? []) as any[];
  const countByDay = new Map<string, number>(revRows.map((r) => [r.d as string, r.c as number]));
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(GRID_WEEKS).fill(0));
  for (let i = 0; i < GRID_DAYS; i += 1) {
    const date = new Date(since + i * DAY_MS);
    const col = Math.floor(i / 7);
    if (col < GRID_WEEKS) grid[date.getDay()][col] = intensity(countByDay.get(localDay(date)) || 0);
  }

  // 卡片成熟度：新規 / 學習中 / 若い(間隔<21d) / 熟成(>=21d)
  const m = db.executeSync(
    `SELECT
       SUM(CASE WHEN state = 0 THEN 1 ELSE 0 END) AS newC,
       SUM(CASE WHEN state = 1 OR state = 3 THEN 1 ELSE 0 END) AS learnC,
       SUM(CASE WHEN state = 2 AND scheduled_days < 21 THEN 1 ELSE 0 END) AS youngC,
       SUM(CASE WHEN state = 2 AND scheduled_days >= 21 THEN 1 ELSE 0 END) AS matureC
     FROM cards`,
  ).rows[0] as any;

  // 學習時間（今日總計 + 每張平均）
  const study = getStudyTimeStats();

  // 各 JLPT 級進度：cards.deck_id 形如 deck-n5；studied = 已開始學(state>0)。
  const levelRows = (db.executeSync(
    `SELECT deck_id, COUNT(*) AS total, SUM(CASE WHEN state > 0 THEN 1 ELSE 0 END) AS studied
     FROM cards GROUP BY deck_id`,
  ).rows ?? []) as any[];
  const perLevel = levelRows
    .map((r) => ({ level: Number(String(r.deck_id).replace('deck-n', '')), total: r.total || 0, studied: r.studied || 0 }))
    .filter((x) => x.level >= 1 && x.level <= 5)
    .sort((a, b) => b.level - a.level); // N5 → N1

  // 記憶目標 vs 完成
  const goalTotal = (db.executeSync('SELECT COUNT(*) AS c FROM cards').rows[0] as any)?.c || 0;
  const goalDone = m?.matureC || 0;

  return {
    streak: getStreak(),
    reviewsToday,
    retention,
    next7,
    next7Total,
    grid,
    maturity: { newC: m?.newC || 0, learnC: m?.learnC || 0, youngC: m?.youngC || 0, matureC: m?.matureC || 0 },
    studyTodayMs: study.todayMs,
    avgPerCardMs: study.avgPerCardMs,
    perLevel,
    goalTotal,
    goalDone,
  };
};
