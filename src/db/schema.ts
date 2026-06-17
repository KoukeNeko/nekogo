import { open } from '@op-engineering/op-sqlite';

export const db = open({
  name: 'kioku.sqlite',
});

// 預設 JLPT 牌組（牌組 = 對 content.vocab 的篩選；這裡只存顯示用 metadata）。
const DEFAULT_DECKS: [string, string, string, string, string][] = [
  ['deck-n5', 'JLPT N5', 'JLPT N5 語彙', '["N5", "語彙"]', '#66D283'],
  ['deck-n4', 'JLPT N4', 'JLPT N4 語彙', '["N4", "語彙"]', '#4DA6FF'],
  ['deck-n3', 'JLPT N3', 'JLPT N3 語彙', '["N3", "語彙"]', '#FF5A36'],
  ['deck-n2', 'JLPT N2', 'JLPT N2 語彙', '["N2", "語彙"]', '#5CB3FF'],
  ['deck-n1', 'JLPT N1', 'JLPT N1 語彙', '["N1", "語彙"]', '#9D72FF'],
];

/**
 * 初始化「可寫主庫」的資料表（decks / cards / revlog）。
 * 詞彙內容（vocab/kanji/example）來自 ATTACH 的唯讀 content 庫，不在此建立。
 *
 * cards 參照 content.vocab.id（不再用 notes）。舊版 cards 以 note_id 參照 notes，
 * 偵測到即丟棄重建（dev 階段拋棄舊複習進度可接受），並移除 notes 表。
 */
export const initDB = () => {
  try {
    // --- 由舊 schema 遷移：cards.note_id + notes → cards.vocab_id ---
    const cardCols = (db.executeSync('PRAGMA table_info(cards)').rows ?? []) as any[];
    if (cardCols.some((col) => col.name === 'note_id')) {
      db.executeSync('DROP TABLE IF EXISTS cards');
      console.log('🔁 遷移：丟棄舊 cards（note_id → vocab_id）');
    }
    db.executeSync('DROP TABLE IF EXISTS notes');

    db.executeSync(`
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        color TEXT
      );
    `);

    db.executeSync(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        vocab_id TEXT NOT NULL,
        deck_id TEXT NOT NULL,
        due INTEGER NOT NULL,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        elapsed_days INTEGER NOT NULL,
        scheduled_days INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        state INTEGER NOT NULL,
        last_review INTEGER
      );
    `);

    // 複習紀錄（FSRS 個人化訓練原料；研究 §C.3 建議從第一天完整記錄）。
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS revlog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT NOT NULL,
        rating INTEGER NOT NULL,
        state INTEGER NOT NULL,
        due INTEGER,
        stability REAL,
        difficulty REAL,
        elapsed_days INTEGER,
        last_elapsed_days INTEGER,
        scheduled_days INTEGER,
        review_time INTEGER NOT NULL
      );
    `);

    db.executeSync('CREATE INDEX IF NOT EXISTS idx_cards_due ON cards (due);');
    db.executeSync('CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards (deck_id);');
    db.executeSync('CREATE INDEX IF NOT EXISTS idx_revlog_card ON revlog (card_id);');

    for (const deck of DEFAULT_DECKS) {
      db.executeSync(
        'INSERT OR IGNORE INTO decks (id, name, description, tags, color) VALUES (?, ?, ?, ?, ?)',
        deck,
      );
    }

    console.log('✅ 主庫 (decks/cards/revlog) 初始化完成');
  } catch (error) {
    console.error('❌ 主庫初始化失敗', error);
  }
};
