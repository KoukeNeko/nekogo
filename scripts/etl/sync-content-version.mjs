// 把 contentDb.ts 的 CONTENT_DB_FILE 版本號蓋章到資產 DB 的 meta 表。
// 每次 bump CONTENT_DB_FILE 後執行；App 掛載時核對此標記，
// 抓出「檔名是新版、內容是舊位元組」的走樣副本（如 Metro 資產快取供舊檔）。
// 用法：node scripts/etl/sync-content-version.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');
const CONTENT_DB_TS_PATH = join(SCRIPT_DIR, '..', '..', 'src', 'db', 'contentDb.ts');

const contentDbSource = readFileSync(CONTENT_DB_TS_PATH, 'utf-8');
const versionMatch = contentDbSource.match(/CONTENT_DB_FILE = 'kioku-content-(v\d+)\.db'/);
if (!versionMatch) {
  console.error('✗ 無法從 contentDb.ts 解析 CONTENT_DB_FILE 版本號');
  process.exit(1);
}
const contentVersion = versionMatch[1];

const db = new DatabaseSync(CONTENT_DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);
db.prepare(
  `INSERT OR REPLACE INTO meta (key, value) VALUES ('content_version', ?)`,
).run(contentVersion);
db.close();
console.log(`✓ 已蓋章 meta.content_version = ${contentVersion}`);
