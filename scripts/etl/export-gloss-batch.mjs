// 匯出下一批待譯 vocab（附完整 JMdict 義項＋詞性），供 session 內人工／LLM 翻譯。
// 寫入 gloss_zh_v2 暫存欄流程：只選 gloss_zh_v2 IS NULL 者，可續跑。
// 用法：node scripts/etl/export-gloss-batch.mjs --out <file> [--limit 60] [--risk]
//   --risk  只選高風險詞性（副詞/感嘆詞/接續詞/助詞）——英譯轉譯壞最兇、人工價值最高。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = get('--out');
const limit = Number(get('--limit') ?? 60);
const risk = args.includes('--risk');
const noRisk = args.includes('--norisk'); // 排除高風險詞性（＝只挑名詞/動詞/形容詞等，如葛藤這類）
const hasGloss = args.includes('--hasgloss'); // 只選已有舊中譯者（＝要修的壞譯，非未翻新詞）
const untranslated = args.includes('--untranslated'); // 只選 gloss_zh 為空者（＝app 顯示英文的那批）
const jlpt = args.includes('--jlpt'); // 只選 JLPT N1–N5（核心學習詞），依 N5→N1＋頻率排序
if (!out) {
  console.error('用法：--out <file> [--limit 60] [--risk]');
  process.exit(1);
}

// JMdict 完整義項索引：id → { senses:[…], pos }。
const dict = JSON.parse(readFileSync(join(CACHE_DIR, 'jmdict-eng-full.json'), 'utf-8'));
const posTags = dict.tags ?? {};
const index = new Map();
for (const word of dict.words) {
  const senses = [];
  const posSet = new Set();
  for (const sense of word.sense ?? []) {
    const gloss = (sense.gloss ?? []).filter((g) => g.lang === 'eng').map((g) => g.text).join('; ');
    if (gloss) senses.push(gloss);
    for (const code of sense.partOfSpeech ?? []) posSet.add(posTags[code] ?? code);
  }
  if (senses.length > 0) index.set(word.id, { senses, pos: [...posSet].join(', ') });
}

const db = new DatabaseSync(CONTENT_DB_PATH, { readOnly: true });
const cols = db.prepare('PRAGMA table_info(vocab)').all();
const hasV2 = cols.some((c) => c.name === 'gloss_zh_v2');
const pendingClause = hasV2 ? 'gloss_zh_v2 IS NULL' : '1=1';
const RISKY_POS = "(pos LIKE '%adverb%' OR pos LIKE '%interjection%' OR pos LIKE '%conjunction%' OR pos LIKE '%particle%')";
const riskClause = risk ? `AND ${RISKY_POS}` : noRisk ? `AND NOT ${RISKY_POS}` : '';
const glossClause = hasGloss
  ? "AND gloss_zh IS NOT NULL AND gloss_zh != ''"
  : untranslated
    ? "AND (gloss_zh IS NULL OR gloss_zh = '')"
    : '';
const jlptClause = jlpt ? 'AND jlpt IS NOT NULL' : '';
// JLPT 模式：N5→N1（jlpt DESC）＋頻率（freq_rank 小者先）；否則沿用 intro_rank。
const orderClause = jlpt
  ? 'ORDER BY jlpt DESC, freq_rank IS NULL, freq_rank ASC, intro_rank'
  : 'ORDER BY intro_rank IS NULL, intro_rank';
const rows = db
  .prepare(
    `SELECT id, expression, reading, gloss, pos FROM vocab
     WHERE ${pendingClause} ${riskClause} ${glossClause} ${jlptClause}
     ${orderClause} LIMIT ?`,
  )
  .all(limit);
db.close();

const items = rows.map((row, i) => {
  const enriched = index.get(row.id);
  return {
    n: i + 1, // 1-based 序號：結果檔用 n 對回，免手打長 id（避免打錯貼到別的詞）。
    id: row.id,
    word: row.expression,
    reading: row.reading,
    pos: enriched?.pos ?? row.pos ?? '',
    senses_en: enriched?.senses ?? [row.gloss],
  };
});
writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`匯出 ${items.length} 筆 → ${out}`);
