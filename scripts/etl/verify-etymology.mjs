// vocab_etymology 整表驗證 harness。任一違規即列出並以非零退出（CI／放量前把關）。
// 用法：node scripts/etl/verify-etymology.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { validateEtymologyEntry } from './lib/etymology-validation.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');

const db = new DatabaseSync(CONTENT_DB_PATH, { readOnly: true });

const tableExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vocab_etymology'")
  .all()
  .length > 0;
if (!tableExists) {
  console.error('✗ vocab_etymology 表不存在（尚未跑過 apply-etymology.mjs）');
  process.exit(1);
}

const rows = db
  .prepare(
    `SELECT e.vocab_id, e.origin_type, e.evolution, e.explanation_zh, e.confidence, e.source, e.source_url,
            v.expression, v.reading
     FROM vocab_etymology e LEFT JOIN vocab v ON v.id = e.vocab_id`,
  )
  .all();
db.close();

const violations = [];
for (const row of rows) {
  const label = `${row.vocab_id}（${row.expression ?? '?'}／${row.reading ?? '?'}）`;
  if (row.reading == null) {
    violations.push(`${label}：vocab_id 在 vocab 表中不存在（孤兒列）`);
    continue;
  }
  let evolution;
  try {
    evolution = JSON.parse(row.evolution);
  } catch {
    violations.push(`${label}：evolution 非合法 JSON`);
    continue;
  }
  const errors = validateEtymologyEntry(
    {
      origin_type: row.origin_type,
      evolution,
      explanation_zh: row.explanation_zh,
      confidence: row.confidence,
      source: row.source,
      source_url: row.source_url,
    },
    row.reading,
  );
  for (const error of errors) violations.push(`${label}：${error}`);
}

if (violations.length > 0) {
  console.error(`✗ ${rows.length} 筆中 ${violations.length} 項違規：`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`✓ vocab_etymology ${rows.length} 筆全數通過驗證`);
