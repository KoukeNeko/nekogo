// 例句 furigana 功能詞旗標：kuromoji 詞性標注，把「助詞・助動詞」的 chunk 標上 f:1。
// App 的例句假名標色改讀此旗標（先前的 chunk 文字白名單會把「半ば」的送假名ば誤判成接續助詞）。
// 冪等：重跑會重算全部旗標。用法：node scripts/etl/enrich-example-furigana.mjs

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const kuromoji = require('kuromoji');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SCRIPT_DIR, '..', '..');
const CONTENT_DB_PATH = join(APP_ROOT, 'assets', 'db', 'kioku-content.db');
const KUROMOJI_DICT_PATH = join(APP_ROOT, 'node_modules', 'kuromoji', 'dict');

const FUNCTIONAL_POS = new Set(['助詞', '助動詞']);

const buildTokenizer = () =>
  new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });

// 句子 → 逐字功能詞遮罩（助詞・助動詞所在的字元為 true）。
const functionalCharMask = (tokenizer, sentence) => {
  const mask = new Array(sentence.length).fill(false);
  let offset = 0;
  for (const token of tokenizer.tokenize(sentence)) {
    const surface = token.surface_form;
    // kuromoji 的 surface 串接應等於原句；保險起見以 indexOf 對齊（跳過對不上的極端情況）。
    const found = sentence.indexOf(surface, offset);
    if (found === -1) continue;
    if (FUNCTIONAL_POS.has(token.pos)) {
      for (let i = found; i < found + surface.length; i += 1) mask[i] = true;
    }
    offset = found + surface.length;
  }
  return mask;
};

const tokenizer = await buildTokenizer();
const db = new DatabaseSync(CONTENT_DB_PATH);
const rows = db.prepare('SELECT id, jp, furigana FROM example').all();
const updateStmt = db.prepare('UPDATE example SET furigana = ? WHERE id = ?');

let updatedRows = 0;
let functionalChunks = 0;
db.exec('BEGIN');
for (const row of rows) {
  let chunks;
  try {
    chunks = JSON.parse(row.furigana);
  } catch {
    continue;
  }
  const mask = functionalCharMask(tokenizer, row.jp);
  let cursor = 0;
  let changed = false;
  for (const chunk of chunks) {
    const start = cursor;
    const end = cursor + chunk.ruby.length;
    cursor = end;
    // 功能詞旗標：整個 chunk 落在助詞・助動詞範圍內，且不是漢字詞（無 rt）。
    const isFunctional =
      !chunk.rt && chunk.ruby.length > 0 && mask.slice(start, end).every(Boolean);
    if (isFunctional) {
      if (chunk.f !== 1) changed = true;
      chunk.f = 1;
      functionalChunks += 1;
    } else if ('f' in chunk) {
      delete chunk.f;
      changed = true;
    }
  }
  if (changed) {
    updateStmt.run(JSON.stringify(chunks), row.id);
    updatedRows += 1;
  }
}
db.exec('COMMIT');
db.close();
console.log(JSON.stringify({ examples: rows.length, updatedRows, functionalChunks }));
