// 例句連結策展：修正「例句裡詞條表記的讀音，對不上詞條 reading」的錯配。
//
// 成因：例句靠 Tanaka B 行「詞頭表記」連到詞條，只比對表記、不比對讀音，故一字多讀的詞
// （万人 ばんにん↔まんにん、味 み↔あじ…）會把別讀音／別義的例句掛錯詞條。
//
// 兩段式（皆冪等）：
//   1. RESCUE：少數「例句其實是詞條讀音、只是 kuromoji 誤標」者，把該表記的 furigana
//      修成詞條 reading（JmdictFurigana 對位），保留連結。修好後它們就對得上、不會被剪。
//   2. PRUNE：解除所有「能正向對齊、但讀音 ≠ 詞條 reading」的 vocab_example 連結。
//      保守：對不齊者不動；純假名詞頭不動；表記==讀音者不列入。
//
// 預設 dry-run（不寫庫）；加 --apply 才寫入。用法：node scripts/etl/apply-example-curation.mjs [--apply]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const CONTENT_DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');
const APPLY = process.argv.slice(2).includes('--apply');

// 搶救清單：{ vid, reading（要修成的詞條讀音）, eids?（限定例句；省略=該詞連到的全部）}。
// 只收「詞條讀音為唯一正確、kuromoji 明顯誤標」或「該句確實用此讀音」的高信心案例。
const RESCUE = [
  { vid: '1584500', reading: 'ばんにん', eids: [15722, 43581] }, // 万人：万人に共通／万人の友（其餘 5万人 屬數量，交給剪枝）
  { vid: '1590830', reading: 'かわるがわる' }, // 代わる代わる（誤標 かわるかわる）
  { vid: '1606000', reading: 'よふかし' }, // 夜更かし（誤標 よるふかし）
  { vid: '1330280', reading: 'さずける' }, // 授ける（誤標 さづける）
  { vid: '1472380', reading: 'はいすい' }, // 排水（誤標 はいみず）
  { vid: '1583050', reading: 'しらが' }, // 白髪（誤標 はくはつ）
  { vid: '1504680', reading: 'たきび' }, // 焚き火（誤標 たきひ）
  { vid: '1433490', reading: 'つうちょう' }, // 通帳（誤標 かよいちょう）
  { vid: '1371910', reading: 'すいとう' }, // 水筒（誤標 みずとう）
  { vid: '1612530', reading: 'ひとりひとり' }, // 一人一人（誤標 いちにんいちにん）
  { vid: '1611030', reading: 'なんでも' }, // 何でも（誤標 なにでも）
  { vid: '1603720', reading: 'ぼっちゃん' }, // 坊ちゃん（誤標 ぼうちゃん）
  { vid: '2847628', reading: 'ひな' }, // 雛（誤標 ひよこ）
  { vid: '1583710', reading: 'ふうしゃ' }, // 風車（オランダの風車＝ふうしゃ；誤標 かざぐるま）
  { vid: '1497690', reading: 'ふぼ' }, // 父母（誤標 ちちはは）
];

const SEP = '\t';
const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
const key = (a, b) => `${a}${SEP}${b}`;
const isKana = (s) => /^[぀-ゟ゠-ヿー]+$/.test(s);

const loadFuriganaIndex = () => {
  const index = new Map();
  for (const e of JSON.parse(stripBom(readFileSync(join(CACHE_DIR, 'JmdictFurigana.json'), 'utf-8')))) {
    index.set(key(e.text, e.reading), e.furigana);
  }
  return index;
};

// 段落陣列中，word 這個表記整段目前拼出的讀音；對不齊回 null，並回傳邊界索引供置換。
const locateWord = (segs, word) => {
  let cursor = 0;
  const bounds = [];
  for (const s of segs) {
    bounds.push(cursor);
    cursor += s.ruby.length;
  }
  bounds.push(cursor);
  for (let i = 0; i < segs.length; i++) {
    let ruby = '';
    for (let j = i; j < segs.length; j++) {
      ruby += segs[j].ruby;
      if (ruby === word) {
        const reading = segs.slice(i, j + 1).map((s) => s.rt ?? s.ruby).join('');
        return { startIdx: i, endIdx: j + 1, reading };
      }
      if (ruby.length >= word.length && !word.startsWith(ruby)) break;
    }
  }
  return null;
};

const db = new DatabaseSync(CONTENT_DB_PATH);
const furiganaIndex = loadFuriganaIndex();
const getVocab = db.prepare('SELECT id, expression, reading FROM vocab WHERE id = ?');
const updExample = db.prepare('UPDATE example SET furigana = ? WHERE id = ?');
const delLink = db.prepare('DELETE FROM vocab_example WHERE vocab_id = ? AND example_id = ?');

// ---- 第 1 段：RESCUE ----
const rescuedPairs = new Set(); // `${vid}\t${eid}`：已搶救者不列入剪枝
const rescuePlans = [];
for (const fix of RESCUE) {
  const v = getVocab.get(fix.vid);
  if (!v) continue;
  const repl = furiganaIndex.get(key(v.expression, fix.reading)) ?? [{ ruby: v.expression, rt: fix.reading }];
  const rows = db
    .prepare(
      `SELECT e.id, e.jp, e.furigana FROM example e
       JOIN vocab_example ve ON ve.example_id = e.id WHERE ve.vocab_id = ?`,
    )
    .all(fix.vid);
  for (const row of rows) {
    if (fix.eids && !fix.eids.includes(row.id)) continue;
    let segs;
    try {
      segs = JSON.parse(row.furigana);
    } catch {
      continue;
    }
    const loc = locateWord(segs, v.expression);
    if (!loc) continue;
    rescuedPairs.add(`${fix.vid}${SEP}${row.id}`);
    if (loc.reading === fix.reading) continue; // 已正確
    const next = [...segs.slice(0, loc.startIdx), ...repl, ...segs.slice(loc.endIdx)];
    rescuePlans.push({ vid: fix.vid, expr: v.expression, eid: row.id, from: loc.reading, to: fix.reading, next, jp: row.jp });
  }
}

// ---- 第 2 段：PRUNE ----
const links = db
  .prepare(
    `SELECT ve.vocab_id AS vid, ve.example_id AS eid, v.expression, v.reading, e.furigana
     FROM vocab_example ve JOIN vocab v ON v.id = ve.vocab_id JOIN example e ON e.id = ve.example_id
     WHERE v.expression != v.reading`,
  )
  .all();

// RESCUE 會就地改 furigana；同一句若還連到「同表記、另一讀音」的別詞條，改後會變新錯配。
// 以 (eid,表記)→新讀音 記錄，剪枝時據此判斷，確保一次收斂（不必跑第二遍）。
const rescuedReadingByExample = new Map();
for (const p of rescuePlans) rescuedReadingByExample.set(`${p.eid}${SEP}${p.expr}`, p.to);

const prunePlans = [];
for (const link of links) {
  if (isKana(link.expression)) continue;
  if (rescuedPairs.has(`${link.vid}${SEP}${link.eid}`)) continue; // 已搶救此詞條的此句，保留
  let effectiveReading = rescuedReadingByExample.get(`${link.eid}${SEP}${link.expression}`);
  if (effectiveReading == null) {
    let segs;
    try {
      segs = JSON.parse(link.furigana);
    } catch {
      continue;
    }
    const loc = locateWord(segs, link.expression);
    if (!loc) continue; // 對不齊，保守不動
    effectiveReading = loc.reading;
  }
  if (effectiveReading !== link.reading) prunePlans.push({ vid: link.vid, eid: link.eid });
}

// 剪枝後變成「零例句」的詞條數（估）
const prunedByVocab = new Map();
for (const p of prunePlans) prunedByVocab.set(p.vid, (prunedByVocab.get(p.vid) ?? 0) + 1);

console.log(`模式：${APPLY ? 'APPLY 寫庫' : 'DRY-RUN 只報告'}`);
console.log(`\n== RESCUE：修 furigana、保留連結 ==（${rescuePlans.length} 句）`);
for (const p of rescuePlans) console.log(`  ${p.expr}  ${p.from}→${p.to}  #${p.eid}  ${p.jp.slice(0, 30)}`);
console.log(`\n== PRUNE：解除連結 ==`);
console.log(`  待解除連結：${prunePlans.length}　影響詞條：${prunedByVocab.size}`);

if (!APPLY) {
  console.log('\n（DRY-RUN，未寫入。確認後加 --apply。）');
  db.close();
} else {
  db.exec('BEGIN');
  for (const p of rescuePlans) updExample.run(JSON.stringify(p.next), p.eid);
  for (const p of prunePlans) delLink.run(p.vid, p.eid);
  db.exec('COMMIT');
  db.close();
  console.log(`\n✅ 已 RESCUE ${rescuePlans.length} 句、PRUNE ${prunePlans.length} 條連結。`);
}
