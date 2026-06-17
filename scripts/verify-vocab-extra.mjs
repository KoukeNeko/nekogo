/**
 * Harness: 驗證 src/data/vocabExtra.json（例句 + 音高重音）。
 * 任一硬性檢查失敗即 exit 1。核心不變性：例句 furigana 的 ruby 串接 = 例句原文。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXTRA_PATH = join(SCRIPT_DIR, '..', 'src', 'data', 'vocabExtra.json');
const SEED_PATH = join(SCRIPT_DIR, '..', 'src', 'data', 'vocabSeed.json');

const MIN_PITCH_COVERAGE = 0.6;
const MIN_EXAMPLE_COVERAGE = 0.6;

let failureCount = 0;
const check = (label, passed, detail = '') => {
  console.log(`${passed ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failureCount += 1;
};

const main = () => {
  console.log('--- 驗證詞彙附加資料（例句 + 音高重音）---\n');

  const extra = JSON.parse(readFileSync(EXTRA_PATH, 'utf-8'));
  const cards = JSON.parse(readFileSync(SEED_PATH, 'utf-8')).cards;
  const ids = Object.keys(extra);

  check('每張卡都有對應 extra 條目', cards.every((card) => extra[card.id] !== undefined), `${ids.length} entries / ${cards.length} cards`);

  const shapeBad = ids.filter((id) => {
    const entry = extra[id];
    const pitchOk = entry.pitch === null || typeof entry.pitch === 'number';
    const exampleOk =
      entry.example === null ||
      (typeof entry.example.jp === 'string' &&
        Array.isArray(entry.example.furigana) &&
        typeof entry.example.en === 'string');
    return !(pitchOk && exampleOk);
  });
  check('每條目 pitch/example 結構正確', shapeBad.length === 0, shapeBad.length ? `異常 ${shapeBad.length}` : '');

  // 不變性：例句 furigana 的 ruby 串接 = 例句原文（漢字/假名都涵蓋）。
  const withExample = ids.filter((id) => extra[id].example);
  const furiganaViolations = withExample.filter((id) => {
    const ex = extra[id].example;
    return ex.furigana.map((seg) => seg.ruby).join('') !== ex.jp;
  });
  check('不變性：例句 furigana ruby 串接 = 原句', furiganaViolations.length === 0, furiganaViolations.length ? `違反 ${furiganaViolations.length}` : '');

  // pitch 數字必須在合理範圍（0..morae 數，這裡寬鬆檢查非負且 < 30）。
  const pitchBad = ids.filter((id) => {
    const p = extra[id].pitch;
    return p !== null && (p < 0 || p > 30);
  });
  check('pitch 數值在合理範圍', pitchBad.length === 0, pitchBad.length ? `異常 ${pitchBad.length}` : '');

  const pitchCoverage = ids.filter((id) => extra[id].pitch !== null).length / ids.length;
  const exampleCoverage = withExample.length / ids.length;
  check(`音高覆蓋率 ≥ ${(MIN_PITCH_COVERAGE * 100).toFixed(0)}%`, pitchCoverage >= MIN_PITCH_COVERAGE, `${(pitchCoverage * 100).toFixed(1)}%`);
  check(`例句覆蓋率 ≥ ${(MIN_EXAMPLE_COVERAGE * 100).toFixed(0)}%`, exampleCoverage >= MIN_EXAMPLE_COVERAGE, `${(exampleCoverage * 100).toFixed(1)}%`);

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
