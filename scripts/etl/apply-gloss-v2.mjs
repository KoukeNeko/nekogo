// 把人工／LLM 翻譯結果寫入 vocab.gloss_zh_v2 暫存欄（不動現有 gloss_zh）。
// 結果格式二選一：[{id, zh}] 直接以 id，或 [{n, zh}]＋--batch 以序號對回 batch 的 id（免手打長 id）。
// 冪等：只填仍為 NULL 的列；容忍 ```json 圍欄。全部驗收後以 translate-zh.mjs --promote 覆寫回 gloss_zh。
// 用法：node scripts/etl/apply-gloss-v2.mjs --file <results.json> [--batch <batch.json>]

import { readFileSync } from 'node:fs';
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
const file = get('--file');
const batchFile = get('--batch');
if (!file) {
  console.error('用法：--file <results.json> [--batch <batch.json>]');
  process.exit(1);
}

const parseJson = (path) =>
  JSON.parse(readFileSync(path, 'utf8').replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim());

const rawItems = parseJson(file);
if (!Array.isArray(rawItems)) throw new Error('結果不是 JSON 陣列');

// n-keyed 結果：以 batch 的序號對回真實 id（免手打長 id，杜絕貼錯到別的詞）。
let items = rawItems;
if (batchFile) {
  const batch = parseJson(batchFile);
  const idByN = new Map(batch.map((b, i) => [b.n ?? i + 1, String(b.id)]));
  items = rawItems.map((r) => ({ id: r.id != null ? String(r.id) : idByN.get(r.n), zh: r.zh }));
}

const db = new DatabaseSync(CONTENT_DB_PATH);
const cols = db.prepare('PRAGMA table_info(vocab)').all();
if (!cols.some((c) => c.name === 'gloss_zh_v2')) {
  db.exec('ALTER TABLE vocab ADD COLUMN gloss_zh_v2 TEXT');
  console.log('已新增 vocab.gloss_zh_v2 欄位');
}
const update = db.prepare('UPDATE vocab SET gloss_zh_v2 = ? WHERE id = ? AND gloss_zh_v2 IS NULL');

let applied = 0;
db.exec('BEGIN');
for (const item of items) {
  const zh = String(item.zh ?? '').trim();
  if (!zh || item.id == null) continue;
  const info = update.run(zh, String(item.id));
  applied += info.changes;
}
db.exec('COMMIT');
const done = db.prepare("SELECT COUNT(*) AS c FROM vocab WHERE gloss_zh_v2 IS NOT NULL AND gloss_zh_v2 != ''").get().c;
db.close();
console.log(JSON.stringify({ received: items.length, applied, v2Total: done }));
