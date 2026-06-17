import { db } from '../schema';

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  color: string | null;
  metrics: {
    totalCards: number;
    newCards: number;
    learningCards: number;
    reviewCards: number;
    dueCards: number;
  };
}

export const getAllDecksWithMetrics = (): Deck[] => {
  const now = new Date().getTime();

  // We can fetch decks and then aggregate stats, or do a complex query.
  // For simplicity and compatibility with op-sqlite, we do a basic query for decks
  // and aggregate metrics via a JOIN or separate queries.
  // Given SQLite, doing a single query with LEFT JOIN and SUM(CASE) is efficient.

  const query = `
    SELECT 
      d.id, 
      d.name, 
      d.description, 
      d.tags, 
      d.color,
      COUNT(c.id) as totalCards,
      SUM(CASE WHEN c.state = 0 THEN 1 ELSE 0 END) as newCards,
      SUM(CASE WHEN (c.state = 1 OR c.state = 3) AND c.due <= ? THEN 1 ELSE 0 END) as learningCards,
      SUM(CASE WHEN c.state = 2 AND c.due <= ? THEN 1 ELSE 0 END) as reviewCards
    FROM decks d
    LEFT JOIN notes n ON n.deck_id = d.id
    LEFT JOIN cards c ON c.note_id = n.id
    GROUP BY d.id
  `;

  const result = db.executeSync(query, [now, now]);
  const rows = result.rows || [];

  return (rows as any[]).map((row: any) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    tags: row.tags ? JSON.parse(row.tags) : [],
    color: row.color,
    metrics: {
      totalCards: row.totalCards || 0,
      newCards: row.newCards || 0,
      learningCards: row.learningCards || 0,
      reviewCards: row.reviewCards || 0,
      dueCards: (row.newCards || 0) + (row.learningCards || 0) + (row.reviewCards || 0)
    }
  }));
};
