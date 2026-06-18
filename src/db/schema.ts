import { open } from '@op-engineering/op-sqlite';

export const db = open({
  name: 'kioku.sqlite',
});

/**
 * 初始化「可寫主庫」的資料表（cards / revlog）。牌組目錄已改為資料驅動，移到內容庫
 * content.decks / content.deck_vocab（見 build-content-db.mjs），不再於主庫存放。
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
    // 牌組目錄改為資料驅動，移到內容庫 content.decks / content.deck_vocab；移除主庫舊的 decks 表。
    db.executeSync('DROP TABLE IF EXISTS decks');

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

    console.log('✅ 主庫 (cards/revlog) 初始化完成');
  } catch (error) {
    console.error('❌ 主庫初始化失敗', error);
  }
};
