import { db } from './schema';
import { createNewCard } from '../services/fsrs';
import { CONTENT_ALIAS } from './contentDb';

const JLPT_LEVELS = [5, 4, 3, 2, 1];

/**
 * 建立 JLPT 牌組卡片：每個 JLPT 詞（content.vocab.jlpt 有值）生一張卡，
 * 指向該詞 (vocab_id) 並歸入 deck-n{level}。非 JLPT 詞留在 content 當目錄（之後其他牌組/搜尋用）。
 *
 * 需在 content 庫 ATTACH 之後呼叫。卡片已存在則略過（cards 為使用者狀態，不重灌）。
 */
export const seedDatabaseIfEmpty = () => {
  const countRow = db.executeSync('SELECT COUNT(*) AS count FROM cards').rows[0] as any;
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  console.log('🌱 由 content.vocab 建立 JLPT 牌組卡片…');
  db.executeSync('BEGIN TRANSACTION');

  try {
    let total = 0;
    for (const level of JLPT_LEVELS) {
      const vocab = (db.executeSync(
        `SELECT id FROM ${CONTENT_ALIAS}.vocab WHERE jlpt = ?`,
        [level],
      ).rows ?? []) as any[];

      for (const row of vocab) {
        const card = createNewCard();
        db.executeSync(
          `INSERT INTO cards (
            id, vocab_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `card-${row.id}`,
            row.id,
            `deck-n${level}`,
            card.due.getTime(),
            card.stability,
            card.difficulty,
            card.elapsed_days,
            card.scheduled_days,
            card.reps,
            card.lapses,
            card.state,
            card.last_review ? card.last_review.getTime() : null,
          ],
        );
        total += 1;
      }
    }
    db.executeSync('COMMIT');
    console.log(`✅ 已建立 ${total} 張卡片`);
  } catch (error) {
    db.executeSync('ROLLBACK');
    console.error('❌ 建立卡片失敗:', error);
  }
};
