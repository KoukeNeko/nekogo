// 把待翻項目匯出成批次 JSON 檔（給翻譯 subagent 用）。
// 用法：node scripts/etl/export-zh-batches.mjs --target vocab|example --out <dir> [--batch-size 250]
// 輸出：<dir>/<target>-0001.json …，每檔為 [{id, ...}] 陣列；只含未翻項目（gloss_zh/zh IS NULL）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = get('--target');
const outDir = get('--out');
const batchSize = Number(get('--batch-size') ?? 250);
if (!target || !outDir) {
  console.error('用法：--target vocab|example --out <dir> [--batch-size N]');
  process.exit(1);
}

const db = new DatabaseSync(CONTENT_DB_PATH, { readOnly: true });
const rows =
  target === 'vocab'
    ? db.prepare('SELECT id, expression, reading, gloss FROM vocab WHERE gloss_zh IS NULL ORDER BY intro_rank IS NULL, intro_rank').all()
    : db.prepare('SELECT id, jp, en FROM example WHERE zh IS NULL ORDER BY id').all();
db.close();

mkdirSync(outDir, { recursive: true });
let fileCount = 0;
for (let i = 0; i < rows.length; i += batchSize) {
  fileCount += 1;
  const name = `${target}-${String(fileCount).padStart(4, '0')}.json`;
  writeFileSync(join(outDir, name), JSON.stringify(rows.slice(i, i + batchSize)));
}
console.log(JSON.stringify({ target, pending: rows.length, files: fileCount, outDir }));
