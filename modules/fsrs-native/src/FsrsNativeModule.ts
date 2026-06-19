import { requireOptionalNativeModule } from 'expo-modules-core';

export interface FsrsNativeModule {
  ping(): number;
  /** 輸入訓練 JSON，回傳結果 JSON（{ok,w,error}）。 */
  optimize(inputJson: string): Promise<string>;
}

// 對應原生端 Name("FsrsNative")。用 optional：原生模組未連結（尚未 dev build /
// 跑在 Expo Go）時回 null，而非在 import 時拋錯使整個 App 崩潰。
export default requireOptionalNativeModule<FsrsNativeModule>('FsrsNative');
