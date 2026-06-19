import FsrsNative from './src/FsrsNativeModule';

export interface OptimizeReview {
  rating: number;
  deltaT: number;
}

export interface OptimizeItem {
  reviews: OptimizeReview[];
}

export interface OptimizeResult {
  ok: boolean;
  w: number[];
  error: string | null;
}

/** 原生模組是否已連結（dev build 才有；Expo Go 為 false）。 */
export const isAvailable = (): boolean => FsrsNative != null;

/** 工具鏈探針：原生回傳 42；未連結時回 null。 */
export function ping(): number | null {
  return FsrsNative ? FsrsNative.ping() : null;
}

/**
 * 用複習歷史訓練 FSRS 參數（fsrs-rs，背景執行緒）。
 * 原生模組未連結時回 null。
 */
export async function optimize(items: OptimizeItem[]): Promise<OptimizeResult | null> {
  if (!FsrsNative) return null;
  const json = await FsrsNative.optimize(JSON.stringify({ items }));
  return JSON.parse(json) as OptimizeResult;
}
