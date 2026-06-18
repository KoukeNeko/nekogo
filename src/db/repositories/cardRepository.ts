import { db } from '../schema';
import { Card } from '../../services/fsrs';
import { VocabItem, FuriganaChunk, ExampleSentence, KanjiInfo } from '../../hooks/useReviewSession';
import { CONTENT_ALIAS as C } from '../contentDb';
import { fetchVocabByIds, ApiVocab } from '../../api/contentApi';

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

// 取該詞的一句例句（content.vocab_example → content.example）。
const loadExample = (vocabId: string): ExampleSentence | null => {
  const row = db.executeSync(
    `SELECT e.jp, e.furigana, e.en FROM ${C}.example e
     JOIN ${C}.vocab_example ve ON e.id = ve.example_id
     WHERE ve.vocab_id = ? LIMIT 1`,
    [vocabId],
  ).rows?.[0] as any;
  if (!row) return null;
  return { jp: row.jp, furigana: parseJson<FuriganaChunk[]>(row.furigana, []), en: row.en };
};

// 取該詞的構成漢字（content.vocab_kanji → content.kanji）。
const loadKanjiList = (vocabId: string): KanjiInfo[] => {
  const rows = (db.executeSync(
    `SELECT k.char, k.strokes, k.stroke_count, k.jlpt, k.on_readings, k.kun_readings, k.meanings
     FROM ${C}.kanji k JOIN ${C}.vocab_kanji vk ON k.char = vk.char
     WHERE vk.vocab_id = ?`,
    [vocabId],
  ).rows ?? []) as any[];
  return rows.map((r) => ({
    char: r.char,
    strokes: parseJson<string[]>(r.strokes, []),
    strokeCount: r.stroke_count ?? null,
    jlpt: r.jlpt ?? null,
    on: parseJson<string[]>(r.on_readings, []),
    kun: parseJson<string[]>(r.kun_readings, []),
    meanings: parseJson<string[]>(r.meanings, []),
  }));
};

// 本機 cards 的一列 → FSRS Card。
const cardRowToFsrs = (row: any): Card =>
  ({
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  } as Card);

// 雲端內容 + 本機 FSRS → VocabItem。例句/構成漢字延後抓（顯示該卡時，見 useReviewSession）。
const toVocabItemFromApi = (vocab: ApiVocab, fsrsCard: Card): VocabItem => ({
  id: vocab.id,
  kanji: vocab.furigana ?? [{ ruby: vocab.expression }],
  reading: vocab.reading,
  english: vocab.gloss,
  pos: vocab.pos ?? null,
  pitch: vocab.pitch ?? null,
  jlpt: vocab.jlpt ?? null,
  example: null,
  kanjiList: [],
  fsrsCard,
});

export const getDailyMetrics = (deckId?: string) => {
  const now = Date.now();
  const deckClause = deckId ? 'AND deck_id = ?' : '';
  const withDeck = (params: any[]) => (deckId ? [...params, deckId] : params);

  const newCards =
    (db.executeSync(`SELECT COUNT(*) AS c FROM cards WHERE state = 0 ${deckClause}`, withDeck([])).rows[0] as any)?.c || 0;
  const learningCards =
    (db.executeSync(`SELECT COUNT(*) AS c FROM cards WHERE (state = 1 OR state = 3) AND due <= ? ${deckClause}`, withDeck([now])).rows[0] as any)?.c || 0;
  const reviewCards =
    (db.executeSync(`SELECT COUNT(*) AS c FROM cards WHERE state = 2 AND due <= ? ${deckClause}`, withDeck([now])).rows[0] as any)?.c || 0;

  return { newCards, learningCards, reviewCards };
};

export const getVocabById = (vocabId: string): VocabItem | null => {
  const row = db.executeSync(
    `SELECT v.id AS vocab_id, v.expression, v.reading, v.furigana, v.gloss, v.pos, v.pitch, v.jlpt
     FROM ${C}.vocab v
     WHERE v.id = ? LIMIT 1`,
    [vocabId]
  ).rows?.[0] as any;
  if (!row) return null;

  const dummyCard: Card = {
    due: new Date(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 0,
  };

  return {
    id: row.vocab_id,
    kanji: parseJson<FuriganaChunk[]>(row.furigana, [{ ruby: row.expression }]),
    reading: row.reading,
    english: row.gloss,
    pos: row.pos ?? null,
    pitch: row.pitch ?? null,
    jlpt: row.jlpt ?? null,
    example: loadExample(row.vocab_id),
    kanjiList: loadKanjiList(row.vocab_id),
    fsrsCard: dummyCard,
  };
};

/**
 * 取本工作階段的卡片：本機挑卡（複習依到期、新卡依 intro_rank）→ 向雲端批次抓內容 → 依序合併。
 * 例句/構成漢字不在此抓，於 useReviewSession 顯示該卡時才取（fetchVocabDetail）。
 */
export const getDueCards = async (
  newLimit: number = 20,
  reviewLimit: number = 50,
  deckId?: string,
): Promise<VocabItem[]> => {
  const now = Date.now();
  const deckClause = deckId ? 'AND c.deck_id = ?' : '';

  // 1. 複習/學習中卡（state > 0 且到期）— 純本機，依到期排序。
  const reviewRows = (db.executeSync(
    `SELECT c.* FROM cards c WHERE c.state > 0 AND c.due <= ? ${deckClause} ORDER BY c.due ASC LIMIT ?`,
    deckId ? [now, deckId, reviewLimit] : [now, reviewLimit],
  ).rows ?? []) as any[];

  // 2. 新卡（state = 0）— 依引入順序（暫用本機 content.intro_rank 排序；Slice 5 移除 ATTACH 後改存於卡片）。
  const newRows = (db.executeSync(
    `SELECT c.* FROM cards c JOIN ${C}.vocab v ON c.vocab_id = v.id
     WHERE c.state = 0 ${deckClause} ORDER BY v.intro_rank IS NULL, v.intro_rank ASC LIMIT ?`,
    deckId ? [deckId, newLimit] : [newLimit],
  ).rows ?? []) as any[];

  const orderedRows = [...reviewRows, ...newRows];
  if (orderedRows.length === 0) return [];

  // 3. 內容向雲端批次取得，依本機挑卡順序組裝（缺內容者略過並記錄，以利診斷內容版本不一致）。
  const vocabById = new Map<string, ApiVocab>();
  for (const vocab of await fetchVocabByIds(orderedRows.map((row) => row.vocab_id))) {
    vocabById.set(vocab.id, vocab);
  }

  const missingIds = orderedRows.filter((row) => !vocabById.has(row.vocab_id)).map((row) => row.vocab_id);
  if (missingIds.length > 0) {
    console.warn(`雲端缺少 ${missingIds.length} 張卡的內容（內容版本可能不一致）：`, missingIds.slice(0, 10));
  }

  const items: VocabItem[] = [];
  for (const row of orderedRows) {
    const vocab = vocabById.get(row.vocab_id);
    if (vocab) items.push(toVocabItemFromApi(vocab, cardRowToFsrs(row)));
  }
  return items;
};

export const updateCardState = (vocabId: string, fsrsCard: Card, rating: number) => {
  db.executeSync(
    `UPDATE cards SET
      due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?,
      reps = ?, lapses = ?, state = ?, last_review = ?
     WHERE vocab_id = ?`,
    [
      fsrsCard.due.getTime(),
      fsrsCard.stability,
      fsrsCard.difficulty,
      fsrsCard.elapsed_days,
      fsrsCard.scheduled_days,
      fsrsCard.reps,
      fsrsCard.lapses,
      fsrsCard.state,
      fsrsCard.last_review ? fsrsCard.last_review.getTime() : null,
      vocabId,
    ],
  );

  // 記錄複習 log（FSRS 個人化訓練原料）。
  db.executeSync(
    `INSERT INTO revlog (card_id, rating, state, due, stability, difficulty, elapsed_days, scheduled_days, review_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `card-${vocabId}`,
      rating,
      fsrsCard.state,
      fsrsCard.due.getTime(),
      fsrsCard.stability,
      fsrsCard.difficulty,
      fsrsCard.elapsed_days,
      fsrsCard.scheduled_days,
      Date.now(),
    ],
  );
};

// 今天複習過的不重複卡片數（用於首頁進度環）。
export const getReviewedTodayCount = (): number => {
  const row = db.executeSync(
    `SELECT COUNT(DISTINCT card_id) AS c FROM revlog
     WHERE date(review_time / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')`,
  ).rows[0] as any;
  return row?.c || 0;
};

const localDayString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// 連續複習天數：從今天（或昨天）往回數有複習紀錄的連續日。
export const getStreak = (): number => {
  const rows = (db.executeSync(
    `SELECT DISTINCT date(review_time / 1000, 'unixepoch', 'localtime') AS d FROM revlog ORDER BY d DESC`,
  ).rows ?? []) as any[];
  const days = new Set(rows.map((r) => r.d as string));
  if (days.size === 0) return 0;

  const today = new Date();
  const cursor = new Date(today);
  // 今天還沒複習但昨天有 → 連續仍成立，從昨天起算。
  if (!days.has(localDayString(today))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(localDayString(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(localDayString(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};
