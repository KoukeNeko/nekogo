// 把翻譯結果批次檔寫回內容庫（參數化 UPDATE，冪等：只填仍為 NULL 的列）。
// 用法：node scripts/etl/apply-zh-results.mjs --target vocab|example --dir <results-dir>
// 結果檔格式：[{ "id": <id>, "zh": "<翻譯>" }, ...]；壞檔記錄後跳過（重翻該批即可）。

import { readdirSync, readFileSync } from 'node:fs';
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
const dir = get('--dir');
if (!target || !dir) {
  console.error('用法：--target vocab|example --dir <results-dir>');
  process.exit(1);
}

const db = new DatabaseSync(CONTENT_DB_PATH);
const update =
  target === 'vocab'
    ? db.prepare("UPDATE vocab SET gloss_zh = ? WHERE id = ? AND gloss_zh IS NULL")
    : db.prepare('UPDATE example SET zh = ? WHERE id = ? AND zh IS NULL');

let applied = 0;
const badFiles = [];
const files = readdirSync(dir).filter((f) => f.startsWith(`${target}-`) && f.endsWith('.json')).sort();
for (const file of files) {
  try {
    const raw = readFileSync(join(dir, file), 'utf8');
    // 容忍模型輸出的 ```json 圍欄。
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) throw new Error('不是陣列');
    db.exec('BEGIN');
    for (const item of items) {
      const zh = String(item.zh ?? '').trim();
      if (!zh || item.id == null) continue;
      update.run(zh, item.id);
      applied += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    badFiles.push(`${file}: ${error.message?.slice(0, 80)}`);
  }
}

const stats =
  target === 'vocab'
    ? db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN gloss_zh IS NOT NULL AND gloss_zh != '' THEN 1 ELSE 0 END) AS done FROM vocab").get()
    : db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN zh IS NOT NULL AND zh != '' THEN 1 ELSE 0 END) AS done FROM example").get();
db.close();
console.log(JSON.stringify({ target, files: files.length, applied, done: stats.done, total: stats.total, badFiles }));
