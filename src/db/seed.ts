import { db } from './schema';
import { createNewCard } from '../services/fsrs';
import vocabSeed from '../data/vocabSeed.json';

interface FuriganaSegment {
  ruby: string;
  rt?: string;
}

// 由 scripts/etl/build-vocab-seed.mjs 從 open-anki-jlpt-decks + JmdictFurigana 產生。
interface SeedCard {
  id: string;
  expression: string;
  reading: string;
  furigana: FuriganaSegment[];
  english: string;
  jlpt: number;
  aligned: boolean;
}

const seedCards = (vocabSeed as { cards: SeedCard[] }).cards;

const insertSeedCard = (card: SeedCard) => {
  // notes.kanji 沿用既有契約：JSON 字串化的 furigana 段落 [{ruby, rt}]，
  // 與 cardRepository 的 JSON.parse 及 FuriganaText 元件相容。
  db.executeSync(
    'INSERT INTO notes (id, kanji, english, deck_id) VALUES (?, ?, ?, ?)',
    [card.id, JSON.stringify(card.furigana), card.english, `deck-n${card.jlpt}`]
  );

  const fsrsCard = createNewCard();
  db.executeSync(
    `INSERT INTO cards (
      id, note_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `card-${card.id}`,
      card.id,
      fsrsCard.due.getTime(),
      fsrsCard.stability,
      fsrsCard.difficulty,
      fsrsCard.elapsed_days,
      fsrsCard.scheduled_days,
      fsrsCard.reps,
      fsrsCard.lapses,
      fsrsCard.state,
      fsrsCard.last_review ? fsrsCard.last_review.getTime() : null,
    ]
  );
};

export const seedDatabaseIfEmpty = () => {
  const result = db.executeSync('SELECT COUNT(*) as count FROM notes');
  const count = (result.rows[0] as any)?.count || 0;

  if (count === seedCards.length) {
    return;
  }

  if (count > 0 && count !== seedCards.length) {
    console.log(`⚠️ Database has ${count} cards, but seed has ${seedCards.length}. Re-seeding...`);
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM cards');
  }

  console.log(`🌱 Seeding database with ${seedCards.length} vocabulary cards...`);
  db.executeSync('BEGIN TRANSACTION');

  try {
    for (const card of seedCards) {
      insertSeedCard(card);
    }
    db.executeSync('COMMIT');
    console.log('✅ Seed completed successfully!');
  } catch (error) {
    db.executeSync('ROLLBACK');
    console.error('❌ Failed to seed database:', error);
  }
};
