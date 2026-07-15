import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  Card,
  RecordLogItem,
  FSRS,
} from 'ts-fsrs';
import { getStoredParameters } from '../db/repositories/fsrsParamsRepository';
import { getTargetRetention } from '../db/repositories/uiSettingsRepository';

// FSRS scheduler。可重建：啟動時 / 最適化後會以本機已訓練的 w 重新建立。
// 集中於本模組存取（previewSchedule / processAnswer），確保永遠用最新參數。
let f: FSRS = fsrs();

// Re-export useful Enums and Types
export { Rating, State, type Card, type RecordLogItem };

/**
 * Creates a brand new empty card for scheduling.
 */
export const createNewCard = (): Card => {
  return createEmptyCard();
};

/**
 * 讀本機已訓練的 FSRS 參數並套用；無則用預設；失敗則保留預設。
 * 需在 DB 初始化（kv 表存在）後呼叫，例如 App 啟動或最適化完成後。
 */
export const applyStoredParameters = (): void => {
  try {
    const weights = getStoredParameters();
    const requestRetention = getTargetRetention();
    f = fsrs(generatorParameters(
      weights ? { w: weights, request_retention: requestRetention } : { request_retention: requestRetention },
    ));
  } catch (error) {
    console.warn('套用自訂 FSRS 參數失敗，改用預設', error);
    f = fsrs();
  }
};

/**
 * 預覽某卡四個評分的下次排程（複習頁顯示間隔用）。
 */
export const previewSchedule = (card: Card, now: Date = new Date()) => {
  return f.repeat(card, now);
};

/**
 * Given a card and its rating, process the answer and return the new card state
 * and scheduling record log.
 */
export const processAnswer = (card: Card, rating: Rating, now: Date = new Date()): RecordLogItem => {
  const schedulingCards = f.repeat(card, now);
  // @ts-ignore - The index typing of schedulingCards requires string/number coercion based on ts-fsrs version
  const recordLog = schedulingCards[rating];
  return recordLog;
};

/**
 * Utility to format the interval into a human-readable string (e.g., 10m, 4d)
 */
export const formatInterval = (dueTime: Date, nowTime: Date = new Date()): string => {
  const diffMs = dueTime.getTime() - nowTime.getTime();
  const diffMinutes = Math.round(diffMs / 1000 / 60);

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}d`;
  }

  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo`;
  }

  const diffYears = Math.round(diffMonths / 12);
  return `${diffYears}y`;
};
