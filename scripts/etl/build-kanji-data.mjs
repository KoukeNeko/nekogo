/**
 * ETL: 建構 App 所需漢字的筆順 + metadata（限縮於詞彙牌組實際用到的漢字）。
 *
 * 來源（皆可商用）：
 *   - KanjiVG (kanjivg.xml)            CC BY-SA 3.0, © Ulrich Apel
 *       每字逐筆 SVG path（109×109 viewBox，與 KanjiStrokeBoard 一致）。
 *   - KANJIDIC2 (kanjidic2-en-*.json)  CC BY-SA 4.0, EDRDG（經 jmdict-simplified）
 *       筆畫數、grade、JLPT、頻率、音讀/訓讀、英文字義。
 *
 * 產出：src/data/kanjiData.json — 漢字資料層，供筆順畫面與（Step 3）kanji 資料表。
 *
 * 僅輸出 vocabSeed.json 表記中實際出現的漢字，以控制檔案大小。
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const KANJIVG_XML_PATH = join(CACHE_DIR, 'kanjivg.xml');
const VOCAB_SEED_PATH = join(SCRIPT_DIR, '..', '..', 'src', 'data', 'vocabSeed.json');
const OUTPUT_PATH = join(SCRIPT_DIR, '..', '..', 'src', 'data', 'kanjiData.json');

const KANJI_START = '一';
const KANJI_END = '鿿';
const READING_TYPE_ON = 'ja_on';
const READING_TYPE_KUN = 'ja_kun';
const MEANING_LANG_EN = 'en';

const isKanji = (char) => char >= KANJI_START && char <= KANJI_END;

const findKanjidicPath = () => {
  const fileName = readdirSync(CACHE_DIR).find(
    (name) => name.startsWith('kanjidic2-en') && name.endsWith('.json'),
  );
  if (!fileName) {
    throw new Error('找不到 kanjidic2-en-*.json，請先執行 seed:download:kanji');
  }
  return join(CACHE_DIR, fileName);
};

/** 由詞彙牌組表記蒐集實際用到的不重複漢字。 */
const collectDeckKanji = () => {
  const seed = JSON.parse(readFileSync(VOCAB_SEED_PATH, 'utf-8'));
  const kanjiSet = new Set();
  for (const card of seed.cards) {
    for (const char of card.expression) {
      if (isKanji(char)) {
        kanjiSet.add(char);
      }
    }
  }
  return kanjiSet;
};

/**
 * 解析 KanjiVG XML → Map<漢字, string[]（逐筆 path d）>。
 * 只取標準字（id 為 kvg:kanji_<5位hex>，排除變體），path 依文件順序即筆順。
 */
const loadStrokesByKanji = () => {
  const xml = readFileSync(KANJIVG_XML_PATH, 'utf-8');
  const strokesByKanji = new Map();

  const kanjiBlockPattern = /<kanji id="kvg:kanji_([0-9a-f]{5})">([\s\S]*?)<\/kanji>/g;
  const pathDataPattern = /\bd="([^"]+)"/g;

  for (const blockMatch of xml.matchAll(kanjiBlockPattern)) {
    const codepoint = parseInt(blockMatch[1], 16);
    const char = String.fromCodePoint(codepoint);
    const strokes = [...blockMatch[2].matchAll(pathDataPattern)].map((match) => match[1]);
    if (strokes.length > 0) {
      strokesByKanji.set(char, strokes);
    }
  }

  return strokesByKanji;
};

const readingValues = (groups, readingType) =>
  groups
    .flatMap((group) => group.readings ?? [])
    .filter((reading) => reading.type === readingType)
    .map((reading) => reading.value);

const englishMeanings = (groups) =>
  groups
    .flatMap((group) => group.meanings ?? [])
    .filter((meaning) => meaning.lang === MEANING_LANG_EN)
    .map((meaning) => meaning.value);

/** 解析 KANJIDIC2 JSON → Map<漢字, metadata>。 */
const loadMetaByKanji = () => {
  const dict = JSON.parse(readFileSync(findKanjidicPath(), 'utf-8'));
  const metaByKanji = new Map();

  for (const character of dict.characters) {
    const groups = character.readingMeaning?.groups ?? [];
    metaByKanji.set(character.literal, {
      strokeCount: character.misc?.strokeCounts?.[0] ?? null,
      grade: character.misc?.grade ?? null,
      jlpt: character.misc?.jlptLevel ?? null,
      frequency: character.misc?.frequency ?? null,
      on: readingValues(groups, READING_TYPE_ON),
      kun: readingValues(groups, READING_TYPE_KUN),
      meanings: englishMeanings(groups),
    });
  }

  return metaByKanji;
};

const buildKanjiData = () => {
  const deckKanji = collectDeckKanji();
  const strokesByKanji = loadStrokesByKanji();
  const metaByKanji = loadMetaByKanji();

  const kanji = {};
  const stats = { total: deckKanji.size, withStrokes: 0, withMeta: 0, missingStrokes: [] };

  for (const char of deckKanji) {
    const strokes = strokesByKanji.get(char) ?? [];
    const meta = metaByKanji.get(char) ?? {
      strokeCount: null,
      grade: null,
      jlpt: null,
      frequency: null,
      on: [],
      kun: [],
      meanings: [],
    };

    if (strokes.length > 0) {
      stats.withStrokes += 1;
    } else {
      stats.missingStrokes.push(char);
    }
    if (metaByKanji.has(char)) {
      stats.withMeta += 1;
    }

    kanji[char] = { strokes, ...meta };
  }

  return { kanji, stats };
};

const main = () => {
  console.log('--- 建構漢字筆順 + metadata (ETL) ---\n');

  const { kanji, stats } = buildKanjiData();

  const output = {
    meta: {
      count: stats.total,
      withStrokes: stats.withStrokes,
      withMeta: stats.withMeta,
      generatedFrom: [
        'KanjiVG r20250816 (CC BY-SA 3.0, © Ulrich Apel)',
        'KANJIDIC2 via jmdict-simplified (CC BY-SA 4.0, EDRDG)',
      ],
    },
    kanji,
  };

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output)}\n`, 'utf-8');

  console.log(`牌組漢字數: ${stats.total}`);
  console.log(`有筆順 (KanjiVG): ${stats.withStrokes}`);
  console.log(`有 metadata (KANJIDIC2): ${stats.withMeta}`);
  if (stats.missingStrokes.length > 0) {
    console.log(`缺筆順: ${stats.missingStrokes.length} 字 — ${stats.missingStrokes.slice(0, 20).join('')}`);
  }
  console.log(`\n✅ 已寫出: ${OUTPUT_PATH}`);
};

try {
  main();
} catch (error) {
  console.error('❌ ETL 失敗:', error.message);
  process.exit(1);
}
