import { db } from '../schema';
import { Card } from '../../services/fsrs';
import { VocabItem } from '../../hooks/useReviewSession';

export const getDailyMetrics = (deckId?: string) => {
  const now = new Date().getTime();
  
  const baseCondition = deckId ? `AND n.deck_id = '${deckId}'` : '';
  const joinNotes = deckId ? `JOIN notes n ON cards.note_id = n.id` : '';
  
  // New cards: state = 0
  const newResult = db.executeSync(`SELECT COUNT(*) as count FROM cards ${joinNotes} WHERE state = 0 ${baseCondition}`);
  const newCards = (newResult.rows[0] as any)?.count || 0;

  // Learning cards: state = 1 (Learning) OR state = 3 (Relearning)
  const learningResult = db.executeSync(`SELECT COUNT(*) as count FROM cards ${joinNotes} WHERE (state = 1 OR state = 3) AND due <= ? ${baseCondition}`, [now]);
  const learningCards = (learningResult.rows[0] as any)?.count || 0;

  // Review cards: state = 2 (Review)
  const reviewResult = db.executeSync(`SELECT COUNT(*) as count FROM cards ${joinNotes} WHERE state = 2 AND due <= ? ${baseCondition}`, [now]);
  const reviewCards = (reviewResult.rows[0] as any)?.count || 0;

  return { newCards, learningCards, reviewCards };
};

export const getDueCards = (newLimit: number = 20, reviewLimit: number = 50, deckId?: string): VocabItem[] => {
  const now = new Date().getTime();
  
  const baseCondition = deckId ? `AND n.deck_id = '${deckId}'` : '';
  
  // 1. Fetch Review / Learning cards (state > 0)
  const reviewResult = db.executeSync(
    `SELECT c.*, n.kanji, n.english 
     FROM cards c
     JOIN notes n ON c.note_id = n.id
     WHERE c.state > 0 AND c.due <= ? ${baseCondition}
     ORDER BY c.due ASC
     LIMIT ?`,
    [now, reviewLimit]
  );
  
  const reviewRows = reviewResult.rows || [];
  
  // 2. Fetch New cards (state = 0)
  const newResult = db.executeSync(
    `SELECT c.*, n.kanji, n.english 
     FROM cards c
     JOIN notes n ON c.note_id = n.id
     WHERE c.state = 0 ${baseCondition}
     ORDER BY c.due ASC
     LIMIT ?`,
    [newLimit]
  );
  
  const newRows = newResult.rows || [];
  
  // 3. Combine them: Reviews first, then New cards
  const combinedRows = [...reviewRows, ...newRows];

  return combinedRows.map((row: any) => ({
    id: row.note_id,
    kanji: JSON.parse(row.kanji),
    english: row.english,
    fsrsCard: {
      due: new Date(row.due),
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      scheduled_days: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
      last_review: row.last_review ? new Date(row.last_review) : undefined,
    } as Card
  }));
};

export const updateCardState = (noteId: string, fsrsCard: Card) => {
  db.executeSync(
    `UPDATE cards SET
      due = ?,
      stability = ?,
      difficulty = ?,
      elapsed_days = ?,
      scheduled_days = ?,
      reps = ?,
      lapses = ?,
      state = ?,
      last_review = ?
     WHERE note_id = ?`,
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
      noteId
    ]
  );
};
