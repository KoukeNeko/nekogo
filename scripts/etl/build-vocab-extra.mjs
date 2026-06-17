/**
 * ETL: 為每張詞彙卡建構「例句 + 音高重音」附加資料（keyed by card id）。
 *
 * 來源：
 *   - Tanaka Corpus examples.utf  例句（日英對照，依詞索引）— EDRDG, CC BY
 *   - Kanjium accents.txt          音高重音（downstep 數字）— CC BY-SA 4.0（來源灰色地帶，
 *                                  商用請改用 UniDic accType，見 RESOURCES.md §6.1）
 *   - JmdictFurigana.json          例句逐字 furigana 對位 — CC BY-SA 4.0
 *   - kuromoji（建置期 devDep）     例句斷詞 + 讀音 → furigana（不進 App bundle）
 *
 * 產出：src/data/vocabExtra.json — 由 review 畫面依卡片 id 查表，無需動 DB schema。
 *   { "n2-0001": { pitch: 2|null, example: { jp, furigana:[{ruby,rt}], en } | null } }
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const kuromoji = require('kuromoji');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const APP_ROOT = join(SCRIPT_DIR, '..', '..');
const VOCAB_SEED_PATH = join(APP_ROOT, 'src', 'data', 'vocabSeed.json');
const EXAMPLES_PATH = join(CACHE_DIR, 'examples.utf');
const ACCENTS_PATH = join(CACHE_DIR, 'accents.txt');
const FURIGANA_JSON_PATH = join(CACHE_DIR, 'JmdictFurigana.json');
const KUROMOJI_DICT_PATH = join(APP_ROOT, 'node_modules', 'kuromoji', 'dict');
const OUTPUT_PATH = join(APP_ROOT, 'src', 'data', 'vocabExtra.json');

const UTF8_BOM = '﻿';
const KEY_SEPARATOR = '\t';
const MIN_EXAMPLE_LEN = 8; // 太短的句子（片段）對學習者幫助低
const MAX_EXAMPLE_LEN = 45; // 太長不適合卡片呈現
const EXAMPLES_PER_HEADWORD = 4; // 每個詞保留最短的數句，挑選時取最佳
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const HIRAGANA_OFFSET = 0x60;
const KANJI_START = '一';
const KANJI_END = '鿿';

const stripBom = (text) => (text.startsWith(UTF8_BOM) ? text.slice(1) : text);
const makeKey = (a, b) => `${a}${KEY_SEPARATOR}${b}`;
const hasKanji = (text) => [...text].some((char) => char >= KANJI_START && char <= KANJI_END);

const katakanaToHiragana = (text) =>
  [...text]
    .map((char) => {
      const code = char.codePointAt(0);
      return code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - HIRAGANA_OFFSET)
        : char;
    })
    .join('');

/** Tanaka B 行的詞條取字典形：去除 (讀音)/[語義]/{表面形}/(#id)/~ 等標記後的字首。 */
const tanakaHeadword = (token) => token.split(/[([{~]/)[0];

const buildKuromojiTokenizer = () =>
  new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });

/** Kanjium accents.txt → Map<expr<TAB>reading, accentNumber>（多讀音取第一個）。 */
const loadAccentIndex = (rawAccents) => {
  const index = new Map();
  for (const line of stripBom(rawAccents).split(/\r?\n/)) {
    if (!line) continue;
    const [expression, reading, accents] = line.split('\t');
    if (!expression || !reading || !accents) continue;
    const firstAccent = Number.parseInt(accents.split(',')[0], 10);
    if (!Number.isNaN(firstAccent)) {
      index.set(makeKey(expression, reading), firstAccent);
    }
  }
  return index;
};

/** JmdictFurigana → Map<text<TAB>reading, segments>（例句逐字對位用）。 */
const loadFuriganaIndex = (rawJson) => {
  const index = new Map();
  for (const entry of JSON.parse(stripBom(rawJson))) {
    index.set(makeKey(entry.text, entry.reading), entry.furigana);
  }
  return index;
};

/**
 * 解析 Tanaka examples.utf，只為 vocab 詞建立索引 Map<headword, [{jp, en, len}]>，
 * 每詞保留最短的數句以控制記憶體。
 */
const buildExampleIndex = (rawExamples, vocabExpressions) => {
  const index = new Map();
  const lines = stripBom(rawExamples).split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith('A: ')) continue;

    const bLine = lines[i + 1];
    if (!bLine || !bLine.startsWith('B: ')) continue;

    const [jpRaw, enRaw] = line.slice(3).split('\t');
    if (!jpRaw || !enRaw) continue;
    const jp = jpRaw.trim();
    const en = enRaw.split('#')[0].trim();
    if (jp.length < MIN_EXAMPLE_LEN || jp.length > MAX_EXAMPLE_LEN) continue;

    const headwords = new Set(
      bLine.slice(3).trim().split(/\s+/).map(tanakaHeadword).filter(Boolean),
    );

    for (const headword of headwords) {
      if (!vocabExpressions.has(headword)) continue;
      const bucket = index.get(headword) ?? [];
      bucket.push({ jp, en, len: jp.length });
      bucket.sort((a, b) => a.len - b.len);
      if (bucket.length > EXAMPLES_PER_HEADWORD) bucket.length = EXAMPLES_PER_HEADWORD;
      index.set(headword, bucket);
    }
  }

  return index;
};

/**
 * 為一句日文產生 furigana 段落：kuromoji 斷詞取讀音，逐 token 以 JmdictFurigana 精準對位，
 * 落空則整 token 標讀音；無漢字 token 不標。
 * 不變性：所有 segment 的 ruby 串接 = 原句。
 */
const sentenceToFurigana = (sentence, tokenizer, furiganaIndex) => {
  const segments = [];
  for (const token of tokenizer.tokenize(sentence)) {
    const surface = token.surface_form;

    if (!hasKanji(surface)) {
      segments.push({ ruby: surface });
      continue;
    }

    const reading = token.reading ? katakanaToHiragana(token.reading) : '';
    const aligned = reading ? furiganaIndex.get(makeKey(surface, reading)) : undefined;
    if (aligned) {
      segments.push(...aligned);
    } else if (reading) {
      segments.push({ ruby: surface, rt: reading });
    } else {
      segments.push({ ruby: surface });
    }
  }
  return segments;
};

/** 從候選句挑最適合卡片的例句（偏好較短、含目標詞）。 */
const pickExample = (expression, exampleIndex) => {
  const candidates = exampleIndex.get(expression);
  if (!candidates || candidates.length === 0) return null;
  return candidates.find((candidate) => candidate.jp.includes(expression)) ?? candidates[0];
};

const main = async () => {
  console.log('--- 建構詞彙附加資料：例句 + 音高重音 (ETL) ---\n');

  const seed = JSON.parse(readFileSync(VOCAB_SEED_PATH, 'utf-8'));
  const cards = seed.cards;
  const vocabExpressions = new Set(cards.map((card) => card.expression));

  const accentIndex = loadAccentIndex(readFileSync(ACCENTS_PATH, 'utf-8'));
  const furiganaIndex = loadFuriganaIndex(readFileSync(FURIGANA_JSON_PATH, 'utf-8'));
  const exampleIndex = buildExampleIndex(readFileSync(EXAMPLES_PATH, 'utf-8'), vocabExpressions);

  console.log('載入 kuromoji 字典中…');
  const tokenizer = await buildKuromojiTokenizer();

  const extra = {};
  const stats = { withPitch: 0, withExample: 0 };

  for (const card of cards) {
    const pitch = accentIndex.get(makeKey(card.expression, card.reading)) ?? null;

    const picked = pickExample(card.expression, exampleIndex);
    let example = null;
    if (picked) {
      example = {
        jp: picked.jp,
        furigana: sentenceToFurigana(picked.jp, tokenizer, furiganaIndex),
        en: picked.en,
      };
    }

    if (pitch !== null) stats.withPitch += 1;
    if (example) stats.withExample += 1;

    extra[card.id] = { pitch, example };
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(extra)}\n`, 'utf-8');

  const total = cards.length;
  console.log(`卡片總數: ${total}`);
  console.log(`有音高重音 (Kanjium): ${stats.withPitch}（${((stats.withPitch / total) * 100).toFixed(1)}%）`);
  console.log(`有例句 (Tanaka): ${stats.withExample}（${((stats.withExample / total) * 100).toFixed(1)}%）`);
  console.log(`\n✅ 已寫出: ${OUTPUT_PATH}`);
};

main().catch((error) => {
  console.error('❌ ETL 失敗:', error.message);
  process.exit(1);
});
