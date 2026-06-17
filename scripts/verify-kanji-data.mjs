/**
 * Harness: 驗證 src/data/kanjiData.json 的完整性。
 * 自動輸出每項檢查的 PASS/FAIL，任一硬性檢查失敗即 exit 1。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(SCRIPT_DIR, '..', 'src', 'data', 'kanjiData.json');

const MIN_EXPECTED_KANJI = 1900;
const MIN_STROKE_COVERAGE = 0.98; // 有筆順的漢字比例下限（少數罕用字可能無 KanjiVG）

let failureCount = 0;

const check = (label, passed, detail = '') => {
  console.log(`${passed ? '✅ PASS' : '❌ FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) {
    failureCount += 1;
  }
};

const main = () => {
  console.log('--- 驗證漢字資料 ---\n');

  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const entries = data.kanji ? Object.entries(data.kanji) : null;

  check('結構含 kanji 物件', Array.isArray(entries), `kanji=${entries ? entries.length : 'N/A'}`);
  if (!entries) {
    return;
  }

  check(`漢字數 ≥ ${MIN_EXPECTED_KANJI}`, entries.length >= MIN_EXPECTED_KANJI, `實際 ${entries.length}`);

  const shapeBad = entries.filter(
    ([, value]) =>
      !Array.isArray(value.strokes) ||
      !Array.isArray(value.on) ||
      !Array.isArray(value.kun) ||
      !Array.isArray(value.meanings),
  );
  check('每字含 strokes/on/kun/meanings 陣列', shapeBad.length === 0, shapeBad.length ? `異常 ${shapeBad.length} 字` : '');

  const withStrokes = entries.filter(([, value]) => value.strokes.length > 0);
  const strokeCoverage = withStrokes.length / entries.length;
  check(
    `筆順覆蓋率 ≥ ${(MIN_STROKE_COVERAGE * 100).toFixed(0)}%`,
    strokeCoverage >= MIN_STROKE_COVERAGE,
    `${withStrokes.length}/${entries.length}（${(strokeCoverage * 100).toFixed(1)}%）`,
  );

  // 每筆 stroke d 必須是非空且像 SVG path（以 M/m 起始）。
  const pathBad = entries.filter(([, value]) =>
    value.strokes.some((d) => typeof d !== 'string' || !/^[Mm]/.test(d.trim())),
  );
  check('每筆 stroke 為合法 SVG path（M 起始）', pathBad.length === 0, pathBad.length ? `異常 ${pathBad.length} 字` : '');

  // INFO：KanjiVG 筆數與 KANJIDIC2 strokeCount 不一致者（變體/異體字屬正常，不視為失敗）。
  const countMismatch = entries.filter(
    ([, value]) => value.strokeCount != null && value.strokes.length > 0 && value.strokeCount !== value.strokes.length,
  );
  console.log(`ℹ️  INFO  KanjiVG 筆數 vs KANJIDIC2 strokeCount 不一致: ${countMismatch.length} 字（變體字屬正常）`);

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
