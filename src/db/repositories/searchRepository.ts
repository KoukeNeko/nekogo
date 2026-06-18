import { db } from '../schema';
import { CONTENT_ALIAS as C } from '../contentDb';

export interface VocabSearchResult {
  id: string;
  expression: string;
  reading: string;
  gloss: string;
  jlpt: number | null;
}

export interface KanjiSearchResult {
  char: string;
  meanings: string;
  on_readings: string;
  kun_readings: string;
}

export interface DeckSearchResult {
  id: string;
  name: string;
  description: string;
  tags: string;
  color: string;
  vocab_count: number;
}

export const searchVocab = (query: string, limit: number = 20): VocabSearchResult[] => {
  if (!query.trim()) return [];
  const safeQuery = `%${query.trim()}%`;
  
  const rows = db.executeSync(
    `SELECT id, expression, reading, gloss, jlpt
     FROM ${C}.vocab
     WHERE expression LIKE ? OR reading LIKE ? OR gloss LIKE ?
     ORDER BY 
       CASE WHEN expression = ? OR reading = ? THEN 1
            WHEN expression LIKE ? OR reading LIKE ? THEN 2
            ELSE 3 END
     LIMIT ?`,
    [safeQuery, safeQuery, safeQuery, query.trim(), query.trim(), `${query.trim()}%`, `${query.trim()}%`, limit]
  ).rows ?? [];

  return rows as VocabSearchResult[];
};

export const searchKanji = (query: string, limit: number = 20): KanjiSearchResult[] => {
  if (!query.trim()) return [];
  const safeQuery = `%${query.trim()}%`;
  
  const rows = db.executeSync(
    `SELECT char, meanings, on_readings, kun_readings
     FROM ${C}.kanji
     WHERE char LIKE ? OR meanings LIKE ? OR on_readings LIKE ? OR kun_readings LIKE ?
     LIMIT ?`,
    [safeQuery, safeQuery, safeQuery, safeQuery, limit]
  ).rows ?? [];

  return rows.map(r => {
    let meanings = '';
    let on_readings = '';
    let kun_readings = '';
    
    try { meanings = JSON.parse(r.meanings as string).join(', '); } catch (e) { meanings = r.meanings as string; }
    try { on_readings = JSON.parse(r.on_readings as string).join(', '); } catch (e) { on_readings = r.on_readings as string; }
    try { kun_readings = JSON.parse(r.kun_readings as string).join(', '); } catch (e) { kun_readings = r.kun_readings as string; }

    return {
      char: r.char as string,
      meanings,
      on_readings,
      kun_readings
    };
  });
};

export const searchDecks = (query: string, limit: number = 20): DeckSearchResult[] => {
  if (!query.trim()) return [];
  const safeQuery = `%${query.trim()}%`;
  
  // Find decks by name OR decks containing matching vocab
  const rows = db.executeSync(
    `SELECT d.id, d.name, d.description, d.tags, d.color, 
            COUNT(DISTINCT v.id) as vocab_count
     FROM decks d
     LEFT JOIN cards c ON d.id = c.deck_id
     LEFT JOIN ${C}.vocab v ON c.vocab_id = v.id 
                            AND (v.expression LIKE ? OR v.reading LIKE ? OR v.gloss LIKE ?)
     WHERE d.name LIKE ? OR d.description LIKE ? OR v.id IS NOT NULL
     GROUP BY d.id
     LIMIT ?`,
    [safeQuery, safeQuery, safeQuery, safeQuery, safeQuery, limit]
  ).rows ?? [];

  return rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    tags: r.tags as string,
    color: r.color as string,
    vocab_count: (r.vocab_count as number) || 0
  }));
};

/**
 * Counts how many cards in a deck match the query.
 * For the "「こう」を含む X語" feature.
 */
export const countMatchingVocabInDeck = (deckId: string, query: string): number => {
  if (!query.trim()) return 0;
  const safeQuery = `%${query.trim()}%`;

  const result = db.executeSync(
    `SELECT COUNT(DISTINCT v.id) as count
     FROM cards c
     JOIN ${C}.vocab v ON c.vocab_id = v.id
     WHERE c.deck_id = ? AND (v.expression LIKE ? OR v.reading LIKE ? OR v.gloss LIKE ?)`,
    [deckId, safeQuery, safeQuery, safeQuery]
  );
  
  return (result.rows[0] as any)?.count ?? 0;
};
