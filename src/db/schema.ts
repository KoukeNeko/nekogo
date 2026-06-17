import { open } from '@op-engineering/op-sqlite';

export const db = open({
  name: 'kioku.sqlite',
});

export const initDB = () => {
  try {
    // Create 'decks' table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS decks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT,
        color TEXT
      );
    `);

    // Create 'notes' table
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        kanji TEXT NOT NULL,
        english TEXT NOT NULL,
        deck_id TEXT,
        FOREIGN KEY (deck_id) REFERENCES decks (id) ON DELETE CASCADE
      );
    `);

    // Migration: Add deck_id to existing notes if it doesn't exist
    try {
      db.executeSync(`ALTER TABLE notes ADD COLUMN deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE;`);
      console.log('✅ Migration: Added deck_id to notes table');
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) {
        console.error('Migration error:', e);
      }
    }

    // Migration: Create default JLPT decks
    try {
      const defaultDecks = [
        ['deck-n1', 'JLPT N1', 'JLPT N1 語彙', '["N1", "語彙"]', '#9D72FF'],
        ['deck-n2', 'JLPT N2', 'JLPT N2 語彙', '["N2", "語彙"]', '#5CB3FF'],
        ['deck-n3', 'JLPT N3', 'JLPT N3 語彙', '["N3", "語彙"]', '#FF5A36'],
        ['deck-n4', 'JLPT N4', 'JLPT N4 語彙', '["N4", "語彙"]', '#4DA6FF'],
        ['deck-n5', 'JLPT N5', 'JLPT N5 語彙', '["N5", "語彙"]', '#66D283']
      ];
      
      for (const d of defaultDecks) {
        db.executeSync(
          'INSERT OR IGNORE INTO decks (id, name, description, tags, color) VALUES (?, ?, ?, ?, ?)',
          d
        );
      }
      
      // We no longer blindly assign everything to deck-n5, as seed.ts will handle it.
      // But we can assign existing orphaned notes to N5 just in case.
      db.executeSync('UPDATE notes SET deck_id = ? WHERE deck_id IS NULL', ['deck-n5']);
    } catch (e: any) {
      console.error('Failed to create default decks:', e);
    }

    // Create 'cards' table for FSRS
    db.executeSync(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        due INTEGER NOT NULL,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        elapsed_days INTEGER NOT NULL,
        scheduled_days INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        state INTEGER NOT NULL,
        last_review INTEGER,
        FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
      );
    `);

    // Index for quick fetching of due cards
    db.executeSync(`
      CREATE INDEX IF NOT EXISTS idx_cards_due ON cards (due);
    `);

    console.log('✅ SQLite Database initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize SQLite database', error);
  }
};
