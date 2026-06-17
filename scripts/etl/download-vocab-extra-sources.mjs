/**
 * 下載例句 + 音高重音 ETL 的原始資料源到 .cache/（gitignore，可隨時重抓）。
 *
 *   - examples.utf   Tanaka Corpus 例句（EDRDG, CC BY）— 由 .gz 解壓
 *   - accents.txt    Kanjium 音高重音（CC BY-SA 4.0，來源灰色地帶，商用見 RESOURCES.md §6.1）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');

const TANAKA_EXAMPLES_URL = 'http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz';
const KANJIUM_ACCENTS_URL =
  'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt';

const fetchBuffer = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const main = async () => {
  console.log('--- 下載例句 + 音高重音原始資料 ---\n');
  mkdirSync(CACHE_DIR, { recursive: true });

  console.log('下載 Tanaka examples.utf …');
  const examples = gunzipSync(await fetchBuffer(TANAKA_EXAMPLES_URL));
  writeFileSync(join(CACHE_DIR, 'examples.utf'), examples);

  console.log('下載 Kanjium accents.txt …');
  writeFileSync(join(CACHE_DIR, 'accents.txt'), await fetchBuffer(KANJIUM_ACCENTS_URL));

  console.log(`\n✅ 原始資料已就緒於 ${CACHE_DIR}`);
};

main().catch((error) => {
  console.error('❌ 下載失敗:', error.message);
  process.exit(1);
});
