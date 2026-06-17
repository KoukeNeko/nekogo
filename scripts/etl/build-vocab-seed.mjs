/**
 * ETL: 由開放授權資料源建構 JLPT N1–N5 預載詞彙牌組。
 *
 * 來源（皆可商用）：
 *   - open-anki-jlpt-decks/src/n{1..5}.csv  (MIT, © Jamie Sinclair；資料源 tanos.co.uk CC BY)
 *       提供 expression / reading / meaning + JLPT 分級。
 *   - JmdictFurigana.json                    (CC BY-SA 4.0, © Doublevil；資料源 JMdict/EDRDG)
 *       提供逐字 furigana 對位 [{ruby, rt}]。
 *
 * 產出：src/data/vocabSeed.json — 由 src/db/seed.ts 灌入 op-sqlite。
 *
 * 設計理由：閃卡多為「已知詞彙」，用 JmdictFurigana 查表對位即可，
 * 無需在 RN 裝置端跑形態素分析（Hermes 無 runtime WASM，見 RESOURCES.md §6.6）。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const FURIGANA_JSON_PATH = join(CACHE_DIR, 'JmdictFurigana.json');
const OUTPUT_PATH = join(SCRIPT_DIR, '..', '..', 'src', 'data', 'vocabSeed.json');

// 由易到難處理：跨級重複詞保留較簡單（較早出現）的級別。
const JLPT_LEVELS = [5, 4, 3, 2, 1];
const CARD_ID_PAD_WIDTH = 4;
const UTF8_BOM = '﻿';
const KEY_SEPARATOR = '\t'; // text/reading 不含 tab，作為查表鍵分隔符安全無歧義
const VARIANT_SEPARATOR = /[;、]/; // 同欄多寫法/讀音分隔符：半形分號「足; 脚」與日文頓號「回る、回す」
const WAVE_DASH_PATTERN = /[～〜]/g; // 接頭/接尾辭標記（如「～時間」），查表與顯示前去除
const PAREN_ANNOTATION_PATTERN = /\s*[（(].*?[)）]\s*/g; // 讀音內 suru 動詞等註記（如「けっこん (する)」）
const SURU_SUFFIX = 'する'; // 漢語サ變動詞讀音常含尾綴 する（如「うんどうする」），JmdictFurigana 鍵為去綴的「うんどう」

const stripBom = (text) => (text.startsWith(UTF8_BOM) ? text.slice(1) : text);

const makeFuriganaKey = (text, reading) => `${text}${KEY_SEPARATOR}${reading}`;

const levelCsvPath = (level) => join(CACHE_DIR, `n${level}.csv`);

/**
 * 解析單行 CSV，支援雙引號包覆的欄位（meaning 內含逗號，如 "to meet, to see"）。
 */
const parseCsvLine = (line) => {
  const fields = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const isEscapedQuote = insideQuotes && line[index + 1] === '"';
      if (isEscapedQuote) {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
};

/**
 * 解析單一 JLPT CSV → [{ expression, reading, meaning }]，並於檔內以 expression+reading 去重。
 */
const parseLevelVocab = (level) => {
  const rawCsv = readFileSync(levelCsvPath(level), 'utf-8');
  const lines = stripBom(rawCsv).split(/\r?\n/).filter((line) => line.length > 0);
  const [headerLine, ...dataLines] = lines;
  const header = parseCsvLine(headerLine);

  const expressionIndex = header.indexOf('expression');
  const readingIndex = header.indexOf('reading');
  const meaningIndex = header.indexOf('meaning');

  if (expressionIndex < 0 || readingIndex < 0 || meaningIndex < 0) {
    throw new Error(`n${level}.csv 缺少必要欄位，實際 header: ${header.join(', ')}`);
  }

  const seenInFile = new Set();
  const vocab = [];

  for (const line of dataLines) {
    const fields = parseCsvLine(line);
    const expression = fields[expressionIndex]?.trim();
    const reading = fields[readingIndex]?.trim();
    const meaning = fields[meaningIndex]?.trim();

    if (!expression || !reading || !meaning) {
      continue;
    }

    const dedupeKey = makeFuriganaKey(expression, reading);
    if (seenInFile.has(dedupeKey)) {
      continue;
    }
    seenInFile.add(dedupeKey);
    vocab.push({ expression, reading, meaning });
  }

  return vocab;
};

/**
 * 載入 JmdictFurigana，建立 `text<TAB>reading` → segments 的精準查表索引。
 */
const loadFuriganaIndex = (rawJson) => {
  const entries = JSON.parse(stripBom(rawJson));
  const byTextReading = new Map();

  for (const entry of entries) {
    byTextReading.set(makeFuriganaKey(entry.text, entry.reading), entry.furigana);
  }

  return byTextReading;
};

/**
 * 由 n{level}.csv 的 expression 欄展開候選表記。
 * 同欄可能含多種寫法（「足; 脚」），波浪號標記接頭/接尾辭（「～時間」）。
 * 回傳去重後的候選陣列，第一個作為卡面顯示用表記。
 */
const expandExpressionCandidates = (rawExpression) => {
  const candidates = rawExpression
    .split(VARIANT_SEPARATOR)
    // 去除括號註記（如「(日本) 式」的「(日本)」、「すみません (かん)」的詞性標記），
    // 與讀音欄一致——讀音本就只含核心部分（しき / すみません）。
    .map((form) => form.replace(PAREN_ANNOTATION_PATTERN, '').replace(WAVE_DASH_PATTERN, '').trim())
    .filter((form) => form.length > 0);
  return [...new Set(candidates)];
};

/**
 * 由 n{level}.csv 的 reading 欄展開候選讀音。
 * 同欄可能含多種讀音（「まいげつ; まいつき」）、suru 動詞註記（「けっこん (する)」）、
 * 接頭/接尾辭波浪號（「～じかん」）。回傳去重後候選，第一個作為卡面顯示用讀音。
 */
const expandReadingCandidates = (rawReading) => {
  const base = rawReading
    .split(VARIANT_SEPARATOR)
    .map((form) => form.replace(PAREN_ANNOTATION_PATTERN, '').replace(WAVE_DASH_PATTERN, '').trim())
    .filter((form) => form.length > 0);

  // 補上去 する 尾綴的候選（僅作後備：原讀音優先，且只有精準命中才採用，故無誤配風險）。
  const withSuruStripped = base
    .filter((form) => form.endsWith(SURU_SUFFIX) && form.length > SURU_SUFFIX.length)
    .map((form) => form.slice(0, -SURU_SUFFIX.length));

  return [...new Set([...base, ...withSuruStripped])];
};

/**
 * 為一個詞解析 furigana 段落、卡面表記與讀音。
 * 逐一嘗試（讀音候選 × 表記候選）做精準對位；命中即用其逐字對位（aligned=true）。
 * 全部落空時整詞當單一 ruby（aligned=false；純假名 / 查無對位屬正常）。
 *
 * 不變性保證：回傳 segments 必能重建出回傳 reading，且 ruby 串接 = 回傳 expression。
 */
const resolveFurigana = (rawExpression, rawReading, furiganaIndex) => {
  const expressionCandidates = expandExpressionCandidates(rawExpression);
  const readingCandidates = expandReadingCandidates(rawReading);
  const displayExpression = expressionCandidates[0] ?? rawExpression.trim();
  const displayReading = readingCandidates[0] ?? rawReading.trim();

  for (const candidateReading of readingCandidates) {
    for (const candidateExpression of expressionCandidates) {
      const exact = furiganaIndex.get(makeFuriganaKey(candidateExpression, candidateReading));
      if (exact) {
        return { expression: candidateExpression, reading: candidateReading, segments: exact, aligned: true };
      }
    }
  }

  return {
    expression: displayExpression,
    reading: displayReading,
    segments: [{ ruby: displayExpression, rt: displayReading }],
    aligned: false,
  };
};

const padCardId = (level, sequence) =>
  `n${level}-${String(sequence).padStart(CARD_ID_PAD_WIDTH, '0')}`;

const buildSeed = () => {
  const furiganaIndex = loadFuriganaIndex(readFileSync(FURIGANA_JSON_PATH, 'utf-8'));

  const seenAcrossLevels = new Set(); // 跨級去重，保留較簡單級別的卡片
  const cards = [];
  const stats = { aligned: 0, fallback: 0, perLevel: {} };

  for (const level of JLPT_LEVELS) {
    const vocab = parseLevelVocab(level);
    let keptInLevel = 0;

    for (const word of vocab) {
      const { expression, reading, segments, aligned } = resolveFurigana(
        word.expression,
        word.reading,
        furiganaIndex,
      );

      const dedupeKey = makeFuriganaKey(expression, reading);
      if (seenAcrossLevels.has(dedupeKey)) {
        continue;
      }
      seenAcrossLevels.add(dedupeKey);
      keptInLevel += 1;

      if (aligned) {
        stats.aligned += 1;
      } else {
        stats.fallback += 1;
      }

      cards.push({
        id: padCardId(level, keptInLevel),
        expression,
        reading,
        furigana: segments,
        english: word.meaning,
        jlpt: level,
        aligned,
      });
    }

    stats.perLevel[level] = keptInLevel;
  }

  return { cards, stats };
};

const main = () => {
  console.log('--- 建構 JLPT N1–N5 預載詞彙牌組 (ETL) ---\n');

  const { cards, stats } = buildSeed();

  const output = {
    meta: {
      levels: JLPT_LEVELS,
      count: cards.length,
      generatedFrom: [
        'open-anki-jlpt-decks/src/n{1..5}.csv (MIT, data from tanos.co.uk CC BY)',
        'JmdictFurigana.json 2.3.1 (CC BY-SA 4.0, from JMdict/EDRDG)',
      ],
    },
    cards,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  const total = cards.length;
  const perLevelSummary = JLPT_LEVELS.map((level) => `N${level}=${stats.perLevel[level]}`).join('  ');
  console.log(`總詞數: ${total}  (${perLevelSummary})`);
  console.log(`JmdictFurigana 精準對位 (aligned): ${stats.aligned}`);
  console.log(`整詞後備 / 純假名 (fallback): ${stats.fallback}`);
  console.log(`精準對位覆蓋率: ${((stats.aligned / total) * 100).toFixed(1)}%`);
  console.log(`\n✅ 已寫出: ${OUTPUT_PATH}`);
};

try {
  main();
} catch (error) {
  console.error('❌ ETL 失敗:', error.message);
  process.exit(1);
}
