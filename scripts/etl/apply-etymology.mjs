// 詞源（語源）批次結果回寫 vocab_etymology。冪等：INSERT OR REPLACE，重跑只覆寫表列詞條。
// 結果以 n 對回匯出批次檔（免手打長 id），全部通過驗證才寫入（任一違規即整批退件、不寫半筆）。
// 用法：node scripts/etl/apply-etymology.mjs --batch <export檔> --results <結果檔>
//
// 結果檔格式：陣列，每筆為下列之一——
//   跳過：{ "n": 3, "skip": true }
//   資料：{ "n": 1, "origin_type": "...", "evolution": { "stages": [...] },
//           "explanation_zh": "...", "confidence": "...", "source": "..."|null }

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validateEtymologyEntry } from './lib/etymology-validation.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');
// 跳過清單存 repo 檔而非 DB：不隨 App 出貨、git 可審閱，export 續跑時據此排除、避免重複送審。
const SKIPLIST_PATH = join(SCRIPT_DIR, 'etymology-skiplist.json');

const args = process.argv.slice(2);
const getFlagValue = (flag) => {
  const flagIndex = args.indexOf(flag);
  return flagIndex >= 0 ? args[flagIndex + 1] : undefined;
};
const batchPath = getFlagValue('--batch');
const resultsPath = getFlagValue('--results');
if (!batchPath || !resultsPath) {
  console.error('用法：node scripts/etl/apply-etymology.mjs --batch <export檔> --results <結果檔>');
  process.exit(1);
}

const batchItems = JSON.parse(readFileSync(batchPath, 'utf-8'));
const results = JSON.parse(readFileSync(resultsPath, 'utf-8'));
const batchByN = new Map(batchItems.map((item) => [item.n, item]));

// 先全數驗證，全過才進 DB；避免半批寫入造成資料庫狀態不明。
const validated = [];
const failures = [];
const skippedIds = [];
for (const result of results) {
  const batchItem = batchByN.get(result.n);
  if (!batchItem) {
    failures.push(`n=${result.n}：批次檔中無此序號`);
    continue;
  }
  if (result.skip === true) {
    skippedIds.push(batchItem.id);
    continue;
  }
  const errors = validateEtymologyEntry(result, batchItem.reading);
  if (errors.length > 0) {
    failures.push(`n=${result.n}（${batchItem.word}／${batchItem.reading}）：${errors.join('；')}`);
    continue;
  }
  validated.push({ vocabId: batchItem.id, entry: result });
}

if (failures.length > 0) {
  console.error(`✗ 驗證失敗 ${failures.length} 筆，整批退件：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const db = new DatabaseSync(CONTENT_DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS vocab_etymology (
  vocab_id TEXT PRIMARY KEY,
  origin_type TEXT NOT NULL,
  evolution TEXT NOT NULL,
  explanation_zh TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT,
  source_url TEXT
)`);
// 舊表（試批初版）沒有 source_url 欄位；就地補欄避免砍表重建。
const hasSourceUrl = db
  .prepare('PRAGMA table_info(vocab_etymology)')
  .all()
  .some((column) => column.name === 'source_url');
if (!hasSourceUrl) {
  db.exec('ALTER TABLE vocab_etymology ADD COLUMN source_url TEXT');
}

const insertStmt = db.prepare(
  `INSERT OR REPLACE INTO vocab_etymology (vocab_id, origin_type, evolution, explanation_zh, confidence, source, source_url)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
db.exec('BEGIN');
for (const { vocabId, entry } of validated) {
  insertStmt.run(
    vocabId,
    entry.origin_type,
    JSON.stringify(entry.evolution),
    entry.explanation_zh,
    entry.confidence,
    entry.source,
    entry.source_url,
  );
}
db.exec('COMMIT');
db.close();

if (skippedIds.length > 0) {
  const existingSkiplist = existsSync(SKIPLIST_PATH)
    ? JSON.parse(readFileSync(SKIPLIST_PATH, 'utf-8'))
    : [];
  const mergedSkiplist = [...new Set([...existingSkiplist, ...skippedIds])].sort();
  writeFileSync(SKIPLIST_PATH, `${JSON.stringify(mergedSkiplist, null, 1)}\n`);
}

console.log(JSON.stringify({ results: results.length, applied: validated.length, skipped: skippedIds.length }));
