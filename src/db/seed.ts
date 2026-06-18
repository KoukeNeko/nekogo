import { db } from './schema';
import { createNewCard } from '../services/fsrs';
import { CONTENT_ALIAS } from './contentDb';

/**
 * 依資料驅動的牌組成員（content.deck_vocab）建立卡片：每個 (deck_id, vocab_id) 生一張卡，
 * 指向該詞並歸入該牌組。目前 JLPT 牌組互斥，故 card id = card-{vocab_id} 不衝突
 * （未來若有重疊的主題牌組，再決定共用卡 vs 每牌組一張卡）。
 *
 * 需在 content 庫 ATTACH 之後呼叫。卡片已存在則略過（cards 為使用者狀態，不重灌）。
 */
export const seedDatabaseIfEmpty = () => {
  const countRow = db.executeSync('SELECT COUNT(*) AS count FROM cards').rows[0] as any;
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  console.log('🌱 由 content.deck_vocab 建立牌組卡片…');
  db.executeSync('BEGIN TRANSACTION');

  try {
    const members = (db.executeSync(
      `SELECT deck_id, vocab_id FROM ${CONTENT_ALIAS}.deck_vocab`,
    ).rows ?? []) as any[];

    for (const member of members) {
      const card = createNewCard();
      db.executeSync(
        `INSERT OR IGNORE INTO cards (
          id, vocab_id, deck_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `card-${member.vocab_id}`,
          member.vocab_id,
          member.deck_id,
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
    }
    db.executeSync('COMMIT');
    console.log(`✅ 已建立 ${members.length} 張卡片`);
  } catch (error) {
    db.executeSync('ROLLBACK');
    console.error('❌ 建立卡片失敗:', error);
  }
};
