import { db } from '../db/schema';
import { buildTrainingItems, MIN_REVIEWS_TO_OPTIMIZE, type RevlogRow } from './fsrsTraining';
import { storeParameters, getRevlogCount } from '../db/repositories/fsrsParamsRepository';
import { applyStoredParameters } from './fsrs';
import { optimize as nativeOptimize, isAvailable } from '../../modules/fsrs-native';

export type OptimizeStatus = 'ok' | 'unavailable' | 'not-enough-data' | 'failed';

export interface OptimizeOutcome {
  status: OptimizeStatus;
  reviewCount: number;
  paramCount: number;
  message: string;
}

/** 目前累積的複習筆數。 */
export const getReviewLogCount = (): number => getRevlogCount();

/** 是否已達可最適化的資料量。 */
export const canOptimize = (): boolean => isAvailable() && getRevlogCount() >= MIN_REVIEWS_TO_OPTIMIZE;

/**
 * 用本機複習歷史訓練 FSRS 參數：查 revlog → 轉訓練輸入 → 原生 fsrs-rs 訓練 →
 * 存參數並即時套用。在背景執行緒訓練（原生 AsyncFunction），不卡 UI。
 */
export const optimizeParameters = async (): Promise<OptimizeOutcome> => {
  const reviewCount = getRevlogCount();

  if (!isAvailable()) {
    return {
      status: 'unavailable',
      reviewCount,
      paramCount: 0,
      message: '最適化エンジンが利用できません（開発ビルドが必要）',
    };
  }

  if (reviewCount < MIN_REVIEWS_TO_OPTIMIZE) {
    return {
      status: 'not-enough-data',
      reviewCount,
      paramCount: 0,
      message: `データ不足：${reviewCount.toLocaleString()} / ${MIN_REVIEWS_TO_OPTIMIZE.toLocaleString()} 件`,
    };
  }

  const rows = (db.executeSync(
    'SELECT card_id, rating, review_time FROM revlog ORDER BY card_id, review_time',
  ).rows ?? []) as unknown as RevlogRow[];

  const items = buildTrainingItems(rows);
  const result = await nativeOptimize(items);

  if (!result || !result.ok || result.w.length === 0) {
    return {
      status: 'failed',
      reviewCount,
      paramCount: 0,
      message: result?.error ?? '最適化に失敗しました',
    };
  }

  storeParameters(result.w);
  applyStoredParameters();

  return {
    status: 'ok',
    reviewCount,
    paramCount: result.w.length,
    message: `最適化完了：${result.w.length} 個のパラメータを更新`,
  };
};
