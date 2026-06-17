/**
 * Harness: 驗證 src/data/vocabSeed.json（JLPT N1–N5）的完整性與對位正確性。
 *
 * 自動輸出每項檢查的 PASS/FAIL，任一硬性檢查失敗即 exit 1。
 * 核心不變性：
 *   - furigana 段落能重建出該卡讀音（rt 優先，純假名段用 ruby）。
 *   - furigana 段落的 ruby 串接 = 該卡表記（expression）。
 * 這兩條保證渲染出的振假名永不與讀音/表記矛盾。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(SCRIPT_DIR, '..', 'src', 'data', 'vocabSeed.json');

const MIN_EXPECTED_CARDS = 5000;
const EXPECTED_LEVELS = [1, 2, 3, 4, 5];
const KANJI_START = '一';
const KANJI_END = '鿿';

const readingFromSegments = (segments) =>
  segments.map((segment) => segment.rt ?? segment.ruby).join('');

const surfaceFromSegments = (segments) =>
  segments.map((segment) => segment.ruby).join('');

let failureCount = 0;

const check = (label, passed, detail = '') => {
  const mark = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) {
    failureCount += 1;
  }
};

const collectViolations = (cards, predicate, limit = 5) => {
  const violations = cards.filter((card) => !predicate(card));
  const sample = violations
    .slice(0, limit)
    .map((card) => `${card.id}:${card.expression}`)
    .join(', ');
  return { count: violations.length, sample };
};

const main = () => {
  console.log('--- 驗證 JLPT N1–N5 預載詞彙牌組 ---\n');

  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));
  const cards = seed.cards;

  check('seed 結構含 cards 陣列', Array.isArray(cards), `cards=${Array.isArray(cards) ? cards.length : 'N/A'}`);
  if (!Array.isArray(cards)) {
    return;
  }

  check(`卡片數 ≥ ${MIN_EXPECTED_CARDS}`, cards.length >= MIN_EXPECTED_CARDS, `實際 ${cards.length}`);

  const presentLevels = new Set(cards.map((card) => card.jlpt));
  const missingLevels = EXPECTED_LEVELS.filter((level) => !presentLevels.has(level));
  check('N1–N5 五級皆有卡片', missingLevels.length === 0, missingLevels.length ? `缺 N${missingLevels.join(', N')}` : '');

  const uniqueIds = new Set(cards.map((card) => card.id));
  check('卡片 id 皆唯一', uniqueIds.size === cards.length, `unique ${uniqueIds.size}/${cards.length}`);

  const uniqueWords = new Set(cards.map((card) => `${card.expression}\t${card.reading}`));
  check('表記+讀音皆唯一（無跨級重複）', uniqueWords.size === cards.length, `unique ${uniqueWords.size}/${cards.length}`);

  const fieldsOk = collectViolations(
    cards,
    (card) => Boolean(card.expression) && Boolean(card.reading) && Boolean(card.english),
  );
  check('每卡含非空 expression/reading/english', fieldsOk.count === 0, fieldsOk.count ? `缺漏 ${fieldsOk.count} 筆: ${fieldsOk.sample}` : '');

  const furiganaOk = collectViolations(
    cards,
    (card) => Array.isArray(card.furigana) && card.furigana.length > 0 && card.furigana.every((seg) => Boolean(seg.ruby)),
  );
  check('每卡 furigana 段落非空且皆有 ruby', furiganaOk.count === 0, furiganaOk.count ? `異常 ${furiganaOk.count} 筆: ${furiganaOk.sample}` : '');

  const readingInvariantOk = collectViolations(
    cards,
    (card) => readingFromSegments(card.furigana) === card.reading,
  );
  check('不變性：furigana 重建讀音 = reading', readingInvariantOk.count === 0, readingInvariantOk.count ? `違反 ${readingInvariantOk.count} 筆: ${readingInvariantOk.sample}` : '');

  const surfaceInvariantOk = collectViolations(
    cards,
    (card) => surfaceFromSegments(card.furigana) === card.expression,
  );
  check('不變性：furigana ruby 串接 = expression', surfaceInvariantOk.count === 0, surfaceInvariantOk.count ? `違反 ${surfaceInvariantOk.count} 筆: ${surfaceInvariantOk.sample}` : '');

  const alignedFieldOk = collectViolations(cards, (card) => typeof card.aligned === 'boolean');
  check('每卡含 aligned provenance 旗標', alignedFieldOk.count === 0, alignedFieldOk.count ? `缺漏 ${alignedFieldOk.count} 筆` : '');

  // 對位覆蓋率：以 ETL 記錄的 aligned 為準（shape 無法區分熟字訓/單漢字 exact 與 fallback）。
  const alignedCount = cards.filter((card) => card.aligned).length;
  console.log(`ℹ️  INFO  JmdictFurigana 精準對位 ${alignedCount}/${cards.length}（${((alignedCount / cards.length) * 100).toFixed(1)}%）`);

  // 真正需關注的品質訊號：多漢字詞卻只有整詞後備（無法逐字對位）。
  const countKanji = (text) => [...text].filter((char) => char >= KANJI_START && char <= KANJI_END).length;
  const suboptimal = cards.filter((card) => !card.aligned && countKanji(card.expression) >= 2);
  const suboptimalRatio = suboptimal.length / cards.length;
  const suboptimalSample = suboptimal.slice(0, 12).map((card) => `${card.expression}/${card.reading}`).join(', ');
  console.log(`${suboptimal.length === 0 ? 'ℹ️  INFO' : '⚠️  WARN'}  多漢字未逐字對位: ${suboptimal.length} 筆（${(suboptimalRatio * 100).toFixed(1)}%）${suboptimal.length ? ` — 例: ${suboptimalSample}` : ''}`);

  console.log('');
  if (failureCount === 0) {
    console.log('✅ 全部硬性檢查通過');
  } else {
    console.log(`❌ ${failureCount} 項檢查失敗`);
    process.exit(1);
  }
};

try {
  main();
} catch (error) {
  console.error('❌ 驗證腳本錯誤:', error.message);
  process.exit(1);
}
