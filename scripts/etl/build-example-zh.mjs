// 例句繁中翻譯（第一階段：Tatoeba 人譯）。
//
// 我們的 example 表源自 Tanaka 語料庫（examples.utf），每句 A 行帶 Tatoeba 句子 ID
// （`A: 日文\t英文#ID=<jpn_id>_<eng_id>`）。本腳本：
//   1. 重新解析 examples.utf 建立「日文原句 → Tatoeba jpn_id」對照（DB 入庫時未保留 ID）。
//   2. 下載 Tatoeba 的 jpn-cmn 連結與 cmn 句庫（CC BY 2.0 FR），得到 jpn_id → 中文句。
//   3. OpenCC（s→tw+台灣用語）轉繁中，寫入 example.zh（欄位不存在則 ALTER 補上）。
// 冪等：只填 zh IS NULL 的列；重跑不會覆蓋既有翻譯。
// 沒被 Tatoeba 覆蓋的例句交給第二階段 translate-zh.mjs（LLM）補全。
//
// 執行：node scripts/etl/build-example-zh.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import * as OpenCC from 'opencc-js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const APP_ROOT = join(SCRIPT_DIR, '..', '..');
const CONTENT_DB_PATH = join(APP_ROOT, 'assets', 'db', 'kioku-content.db');

const TATOEBA_FILES = [
  { name: 'jpn-cmn_links.tsv', url: 'https://downloads.tatoeba.org/exports/per_language/jpn/jpn-cmn_links.tsv.bz2' },
  { name: 'cmn_sentences.tsv', url: 'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2' },
];

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** 下載並解壓 bz2 到快取（已存在則略過）。 */
const ensureTatoebaCached = () => {
  for (const file of TATOEBA_FILES) {
    const dest = join(CACHE_DIR, file.name);
    if (existsSync(dest)) continue;
    console.log(`下載 ${file.url} …`);
    execFileSync('curl', ['-fsSL', '-o', `${dest}.bz2`, file.url], { stdio: 'inherit' });
    execFileSync('bunzip2', ['-f', `${dest}.bz2`], { stdio: 'inherit' });
  }
};

/** examples.utf → Map<日文原句, Tatoeba jpn_id>（與 build-content-db.mjs 相同的 trim 規則）。 */
const buildJpToTatoebaId = () => {
  const map = new Map();
  const lines = stripBom(readFileSync(join(CACHE_DIR, 'examples.utf'), 'utf8')).split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('A: ')) continue;
    const [jpRaw, enRaw] = line.slice(3).split('\t');
    if (!jpRaw || !enRaw) continue;
    // #ID=<eng_id>_<jpn_id>：第二個數字才是日文句的 Tatoeba ID（實測對 links 檔驗證）。
    const idMatch = enRaw.match(/#ID=\d+_(\d+)/);
    if (!idMatch) continue;
    map.set(jpRaw.trim(), Number(idMatch[1]));
  }
  return map;
};

/** jpn-cmn_links.tsv → Map<jpn_id, cmn_id[]>。 */
const buildLinkIndex = () => {
  const map = new Map();
  const lines = readFileSync(join(CACHE_DIR, 'jpn-cmn_links.tsv'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const [jpnId, cmnId] = line.split('\t');
    if (!jpnId || !cmnId) continue;
    const key = Number(jpnId);
    const bucket = map.get(key) ?? [];
    bucket.push(Number(cmnId));
    map.set(key, bucket);
  }
  return map;
};

/** cmn_sentences.tsv → Map<cmn_id, 中文句>。 */
const buildCmnIndex = () => {
  const map = new Map();
  const lines = readFileSync(join(CACHE_DIR, 'cmn_sentences.tsv'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const [id, , text] = line.split('\t');
    if (!id || !text) continue;
    map.set(Number(id), text.trim());
  }
  return map;
};

const ensureZhColumn = (db) => {
  const cols = db.prepare('PRAGMA table_info(example)').all();
  if (!cols.some((col) => col.name === 'zh')) {
    db.exec('ALTER TABLE example ADD COLUMN zh TEXT');
    console.log('已新增 example.zh 欄位');
  }
};

const run = () => {
  if (!existsSync(CONTENT_DB_PATH)) {
    console.error(`❌ 找不到內容庫：${CONTENT_DB_PATH}`);
    process.exit(1);
  }
  ensureTatoebaCached();

  console.log('建立索引…');
  const jpToId = buildJpToTatoebaId();
  const links = buildLinkIndex();
  const cmnById = buildCmnIndex();
  console.log(`examples.utf 句數 ${jpToId.size}、jpn-cmn 連結 ${links.size}、cmn 句庫 ${cmnById.size}`);

  // s → 繁中（含台灣用語轉換，如 信息→訊息）。
  const toTaiwan = OpenCC.Converter({ from: 'cn', to: 'twp' });

  const db = new DatabaseSync(CONTENT_DB_PATH);
  ensureZhColumn(db);

  const rows = db.prepare('SELECT id, jp FROM example WHERE zh IS NULL').all();
  const update = db.prepare('UPDATE example SET zh = ? WHERE id = ?');
  let matched = 0;
  db.exec('BEGIN');
  for (const row of rows) {
    const jpnId = jpToId.get(row.jp);
    if (jpnId == null) continue;
    const cmnIds = links.get(jpnId);
    if (!cmnIds?.length) continue;
    // 多個翻譯時取最短（例句顯示空間有限，短句通常也最直譯）。
    let best = null;
    for (const cmnId of cmnIds) {
      const text = cmnById.get(cmnId);
      if (text && (best == null || text.length < best.length)) best = text;
    }
    if (!best) continue;
    update.run(toTaiwan(best), row.id);
    matched += 1;
  }
  db.exec('COMMIT');

  const total = db.prepare('SELECT COUNT(*) AS c FROM example').get().c;
  const covered = db.prepare("SELECT COUNT(*) AS c FROM example WHERE zh IS NOT NULL AND zh != ''").get().c;
  db.close();
  console.log(`本次寫入 ${matched} 句；累計覆蓋 ${covered}/${total}（${((covered / total) * 100).toFixed(1)}%）`);
  console.log('未覆蓋的例句請跑 translate-zh.mjs（LLM）補全。');
};

run();
