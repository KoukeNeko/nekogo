/**
 * 下載 jmdict-simplified 的 eng-common 詞庫到 .cache/jmdict-eng-common.json。
 * （CC BY-SA 4.0, EDRDG —— 內容庫 vocab 的主要來源）
 * 由 .json.tgz 解壓（gunzip + 單檔 tar）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const RELEASE_API = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const ASSET_PATTERN = /^jmdict-eng-common-.*\.json\.tgz$/;
const TAR_HEADER_SIZE = 512;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_LENGTH = 12;

const fetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`API 失敗 ${res.status} ${res.statusText}: ${url}`);
  return res.json();
};

const fetchBuffer = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載失敗 ${res.status} ${res.statusText}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

const extractSingleFileFromTar = (tar) => {
  const sizeField = tar.toString('ascii', TAR_SIZE_OFFSET, TAR_SIZE_OFFSET + TAR_SIZE_LENGTH).replace(/\0.*$/, '').trim();
  const size = parseInt(sizeField, 8);
  return tar.subarray(TAR_HEADER_SIZE, TAR_HEADER_SIZE + size);
};

const main = async () => {
  console.log('--- 下載 jmdict-eng-common ---\n');
  mkdirSync(CACHE_DIR, { recursive: true });

  const release = await fetchJson(RELEASE_API);
  const asset = release.assets?.find((a) => ASSET_PATTERN.test(a.name));
  if (!asset) throw new Error(`release 找不到符合 ${ASSET_PATTERN} 的資產`);

  console.log(`下載 ${asset.name} (${release.tag_name}) …`);
  const json = extractSingleFileFromTar(gunzipSync(await fetchBuffer(asset.browser_download_url)));
  writeFileSync(join(CACHE_DIR, 'jmdict-eng-common.json'), json);

  console.log(`\n✅ 已就緒於 ${CACHE_DIR}/jmdict-eng-common.json`);
};

main().catch((error) => {
  console.error('❌ 下載失敗:', error.message);
  process.exit(1);
});
