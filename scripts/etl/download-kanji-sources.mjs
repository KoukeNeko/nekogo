/**
 * 下載漢字 ETL 的原始資料源到 .cache/（gitignore，可隨時重抓）。
 *
 *   - kanjivg.xml          KanjiVG 最新 release 的 .xml.gz（解壓後）— CC BY-SA 3.0
 *   - kanjidic2-en.json    jmdict-simplified 最新 release 的 kanjidic2-en .json.tgz（解壓後）— CC BY-SA 4.0
 *
 * 皆可商用（須署名，見 RESOURCES.md §8）。node 內建 zlib 解 gzip；tgz 以最小單檔 tar 解析。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');

const KANJIVG_RELEASE_API = 'https://api.github.com/repos/KanjiVG/kanjivg/releases/latest';
const JMDICT_RELEASE_API = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const KANJIVG_ASSET_PATTERN = /^kanjivg-\d+\.xml\.gz$/;
const KANJIDIC2_ASSET_PATTERN = /^kanjidic2-en-.*\.json\.tgz$/;

const TAR_HEADER_SIZE = 512;
const TAR_SIZE_FIELD_OFFSET = 124;
const TAR_SIZE_FIELD_LENGTH = 12;

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    throw new Error(`API 失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
};

const fetchBuffer = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下載失敗 ${response.status} ${response.statusText}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const resolveAssetUrl = async (releaseApi, assetPattern) => {
  const release = await fetchJson(releaseApi);
  const asset = release.assets?.find((candidate) => assetPattern.test(candidate.name));
  if (!asset) {
    throw new Error(`release 找不到符合 ${assetPattern} 的資產`);
  }
  return { url: asset.browser_download_url, tag: release.tag_name };
};

/** 從單檔 ustar 取出內容（gunzip 後的 tar buffer）。 */
const extractSingleFileFromTar = (tarBuffer) => {
  const sizeField = tarBuffer
    .toString('ascii', TAR_SIZE_FIELD_OFFSET, TAR_SIZE_FIELD_OFFSET + TAR_SIZE_FIELD_LENGTH)
    .replace(/\0.*$/, '')
    .trim();
  const size = parseInt(sizeField, 8);
  return tarBuffer.subarray(TAR_HEADER_SIZE, TAR_HEADER_SIZE + size);
};

const main = async () => {
  console.log('--- 下載漢字原始資料 ---\n');
  mkdirSync(CACHE_DIR, { recursive: true });

  const kanjivg = await resolveAssetUrl(KANJIVG_RELEASE_API, KANJIVG_ASSET_PATTERN);
  console.log(`下載 KanjiVG (${kanjivg.tag}) …`);
  const kanjivgXml = gunzipSync(await fetchBuffer(kanjivg.url));
  writeFileSync(join(CACHE_DIR, 'kanjivg.xml'), kanjivgXml);

  const kanjidic2 = await resolveAssetUrl(JMDICT_RELEASE_API, KANJIDIC2_ASSET_PATTERN);
  console.log(`下載 KANJIDIC2 (${kanjidic2.tag}) …`);
  const kanjidic2Json = extractSingleFileFromTar(gunzipSync(await fetchBuffer(kanjidic2.url)));
  writeFileSync(join(CACHE_DIR, 'kanjidic2-en.json'), kanjidic2Json);

  console.log(`\n✅ 漢字原始資料已就緒於 ${CACHE_DIR}`);
};

main().catch((error) => {
  console.error('❌ 下載失敗:', error.message);
  process.exit(1);
});
