import { db } from './src/db/schema';
import { attachContentDb } from './src/db/contentDb';

const run = async () => {
  await attachContentDb();
  
  // Test words for '長'
  const words = db.executeSync(`
    SELECT v.expression, v.reading, v.gloss
    FROM content.vocab v
    JOIN content.vocab_kanji vk ON v.id = vk.vocab_id
    WHERE vk.char = '長'
    LIMIT 3
  `).rows;
  console.log("Words:", JSON.stringify(words, null, 2));

  // Test examples for '長'
  const examples = db.executeSync(`
    SELECT e.jp, e.en
    FROM content.example e
    WHERE e.jp LIKE '%長%'
    LIMIT 3
  `).rows;
  console.log("Examples:", JSON.stringify(examples, null, 2));
}

run();
