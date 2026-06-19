import { db } from './schema';
import { createNewCard } from '../services/fsrs';
import { fetchDeckMembers } from '../api/contentApi';
import { getSelectedDecks } from './repositories/selectedDecksRepository';

/**
 * 範圍感知 + 增量建卡：只為「目標牌組」向雲端取成員建立本機卡片，而非一次 seed 全部。
 * 每個 (deck_id, vocab_id) 生一張卡（card id = card-{vocab_id}），並存下 intro_rank（新卡引入順序）。
 * 卡片是使用者狀態，已存在則以 INSERT OR IGNORE 略過 → 增量、可重入（不重灌複習進度）。
 * 目前 JLPT 與頻率分級牌組互斥，故 card id = card-{vocab_id} 不衝突。
 *
 * 目標牌組解析：傳入的 deckIds 優先；未傳則取目前學習範圍（getSelectedDecks）；
 * 學習範圍為空（= 全部）時，套用預設範圍（5 個 JLPT 包），首次啟動只建約 7,965 張卡。
 *
 * 需要連到伺服器；若離線則本次不建卡（拋錯由呼叫端記錄），下次仍會重試。
 */

// 預設範圍：學習範圍未明確指定時，只 seed 5 個 JLPT 包（避免一次建立 20 萬張卡）。
const DEFAULT_SEED_DECK_IDS = ['deck-n1', 'deck-n2', 'deck-n3', 'deck-n4', 'deck-n5'];

// 解析本次要 seed 的目標牌組：明確傳入 → 用之；否則用學習範圍；學習範圍空 → 預設範圍。
const resolveSeedTargets = (deckIds?: string[]): string[] => {
  if (deckIds && deckIds.length > 0) return deckIds;
  const selected = getSelectedDecks();
  return selected.length > 0 ? selected : DEFAULT_SEED_DECK_IDS;
};

export const ensureSelectedDeckCards = async (deckIds?: string[]): Promise<void> => {
  const targetDeckIds = resolveSeedTargets(deckIds);
  if (targetDeckIds.length === 0) return;

  console.log('🌱 為目標牌組增量建卡：', targetDeckIds.join(', '));
  // 各包成員平行抓回（含 introRank，已由伺服器依 intro_rank 升冪排序）。網路抓取在開啟交易之前完成。
  const deckMemberLists = await Promise.all(
    targetDeckIds.map((deckId) => fetchDeckMembers(deckId).then((members) => ({ deckId, members }))),
  );

  db.executeSync('BEGIN TRANSACTION');
  try {
    let processed = 0;
    for (const { deckId, members } of deckMemberLists) {
      for (const member of members) {
        const card = createNewCard();
        db.executeSync(
          `INSERT OR IGNORE INTO cards (
            id, vocab_id, deck_id, intro_rank, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `card-${member.id}`,
            member.id,
            deckId,
            member.introRank ?? null,
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
        processed += 1;
      }
    }
    db.executeSync('COMMIT');
    console.log(`✅ 已處理 ${processed} 筆成員（已存在者經 INSERT OR IGNORE 略過）`);
  } catch (error) {
    db.executeSync('ROLLBACK');
    console.error('❌ 建立卡片失敗:', error);
    throw error;
  }
};
