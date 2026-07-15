import { fetchVocabEtymology, ApiEtymology, ApiEtymologyStage } from '../../api/contentApi';

export type Etymology = ApiEtymology;
export type EtymologyStage = ApiEtymologyStage;

/** 取得單字詞源（語源）。查無資料或舊版內容庫無此表皆回傳 null（呼叫端據此隱藏區塊）。 */
export const getEtymology = async (vocabId: string): Promise<Etymology | null> => {
  try {
    return await fetchVocabEtymology(vocabId);
  } catch (error) {
    console.error('查詢詞源失敗', error);
    return null;
  }
};
