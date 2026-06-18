import { db } from './schema';
import { createNewCard } from '../services/fsrs';
import { fetchDecks, fetchDeckVocab } from '../api/contentApi';

/**
 * 首次啟動時，向雲端取各卡包成員建立本機卡片：每個 (deck_id, vocab_id) 生一張卡，
 * 並存下 intro_rank（新卡引入順序）。卡片是使用者狀態，已存在則略過、不重灌。
 * 目前 JLPT 牌組互斥，故 card id = card-{vocab_id} 不衝突。
 *
 * 需要連到伺服器；若離線則本次不建卡（拋錯由呼叫端記錄），下次啟動仍會重試。
 */
export const seedDatabaseIfEmpty = async (): Promise<void> => {
  const countRow = db.executeSync('SELECT COUNT(*) AS count FROM cards').rows[0] as any;
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  console.log('🌱 由雲端卡包建立牌組卡片…');
  const decks = await fetchDecks();
  // 各包詞彙平行抓回（含 introRank，已由伺服器依引入順序排序）。網路抓取在開啟交易之前完成。
  const deckVocabLists = await Promise.all(
    decks.map((deck) => fetchDeckVocab(deck.id).then((vocab) => ({ deckId: deck.id, vocab }))),
  );

  db.executeSync('BEGIN TRANSACTION');
  try {
    let total = 0;
    for (const { deckId, vocab } of deckVocabLists) {
      for (const item of vocab) {
        const card = createNewCard();
        db.executeSync(
          `INSERT OR IGNORE INTO cards (
            id, vocab_id, deck_id, intro_rank, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `card-${item.id}`,
            item.id,
            deckId,
            item.introRank ?? null,
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
    throw error;
  }
};
