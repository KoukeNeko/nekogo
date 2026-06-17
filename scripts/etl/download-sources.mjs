/**
 * 下載詞彙種子 ETL 的原始資料源到 .cache/（gitignore，可隨時重抓）。
 *
 *   - n1.csv … n5.csv     open-anki-jlpt-decks main 分支（MIT）
 *   - JmdictFurigana.json Doublevil 最新 release（CC BY-SA 4.0）
 *
 * 兩者皆可商用（須署名，見 RESOURCES.md §8）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');

const JLPT_LEVELS = [1, 2, 3, 4, 5];
const jlptCsvUrl = (level) =>
  `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n${level}.csv`;
const FURIGANA_LATEST_RELEASE_API =
  'https://api.github.com/repos/Doublevil/JmdictFurigana/releases/latest';
const FURIGANA_ASSET_NAME = 'JmdictFurigana.json';

const fetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return response.text();
};

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`API 失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
};

const resolveFuriganaAssetUrl = async () => {
  const release = await fetchJson(FURIGANA_LATEST_RELEASE_API);
  const asset = release.assets?.find((candidate) => candidate.name === FURIGANA_ASSET_NAME);
  if (!asset) {
    throw new Error(`JmdictFurigana release 找不到資產: ${FURIGANA_ASSET_NAME}`);
  }
  return { url: asset.browser_download_url, tag: release.tag_name };
};

const main = async () => {
  console.log('--- 下載詞彙種子原始資料 ---\n');
  mkdirSync(CACHE_DIR, { recursive: true });

  for (const level of JLPT_LEVELS) {
    const fileName = `n${level}.csv`;
    console.log(`下載 ${fileName} …`);
    writeFileSync(join(CACHE_DIR, fileName), await fetchText(jlptCsvUrl(level)), 'utf-8');
  }

  const furigana = await resolveFuriganaAssetUrl();
  console.log(`下載 JmdictFurigana.json (${furigana.tag}) …`);
  writeFileSync(join(CACHE_DIR, 'JmdictFurigana.json'), await fetchText(furigana.url), 'utf-8');

  console.log(`\n✅ 原始資料已就緒於 ${CACHE_DIR}`);
};

main().catch((error) => {
  console.error('❌ 下載失敗:', error.message);
  process.exit(1);
});
