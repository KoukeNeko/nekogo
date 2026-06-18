import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { db } from './schema';

/**
 * 唯讀「內容庫」(kioku-content.db) 的載入與掛載。
 *
 * 內容庫由 scripts/etl/build-content-db.mjs 於 build 階段組好（vocab/kanji/example/連結表），
 * 隨 App 打包。首次啟動時複製到可寫的 documentDirectory，再以絕對路徑 ATTACH 到主連線
 * (kioku.sqlite) 的別名 `content`，之後即可跨庫 JOIN（cards ↔ content.vocab）。
 *
 * 注意：必須複製到 documentDirectory —— expo-file-system 只允許寫入它管理的目錄，
 * 寫到 op-sqlite 的 Library 路徑會得到 "is not writable"。SQLite ATTACH 接受任意絕對路徑，
 * 所以不需要把檔案放在 op-sqlite 的預設位置。
 *
 * cards / revlog 等可變資料留在主庫；內容庫唯讀，改版只需 bump CONTENT_DB_FILE 重新複製。
 */

export const CONTENT_ALIAS = 'content';
// 內容版本：bump 檔名即可在下次啟動強制重新複製（不動主庫的 cards/revlog）。
// v2：音高改用 UniDic（取代 Kanjium）、新增 freq_rank 詞頻 + intro_rank 引入順序。
// v4：用全新版本號強制重抓 —— 開發模擬器殘留舊 v2/v3 快取（無 intro_rank 欄位）會擋住重抓。
const CONTENT_DB_FILE = 'kioku-content-v4.db';
const DEST_URI = `${FileSystem.documentDirectory}${CONTENT_DB_FILE}`;
const DEST_PATH = DEST_URI.replace('file://', '');

let attached = false;

const ensureContentDbCopied = async (): Promise<void> => {
  const info = await FileSystem.getInfoAsync(DEST_URI);
  if (info.exists) {
    return;
  }
  const asset = Asset.fromModule(require('../../assets/db/kioku-content.db'));
  await asset.downloadAsync();
  if (!asset.localUri) {
    throw new Error('內容庫資產無 localUri，無法複製');
  }
  await FileSystem.copyAsync({ from: asset.localUri, to: DEST_URI });
  console.log('✅ 內容庫已複製至 documentDirectory');
};

/** 複製（首次）並把內容庫 ATTACH 到主連線。需在任何 content.* 查詢前 await。 */
export const attachContentDb = async (): Promise<void> => {
  if (attached) {
    return;
  }
  await ensureContentDbCopied();
  db.executeSync(`ATTACH DATABASE '${DEST_PATH}' AS ${CONTENT_ALIAS}`);
  attached = true;

  const result = db.executeSync(`SELECT COUNT(*) AS count FROM ${CONTENT_ALIAS}.vocab`);
  const count = (result.rows[0] as any)?.count ?? 0;
  console.log(`✅ 內容庫已掛載 — content.vocab 共 ${count} 筆`);
};
