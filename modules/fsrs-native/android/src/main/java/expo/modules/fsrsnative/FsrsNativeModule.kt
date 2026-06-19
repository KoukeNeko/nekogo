package expo.modules.fsrsnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FsrsNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FsrsNative")

    // 工具鏈探針（與 iOS 對齊回 42；確認 Expo 模組載入）。
    Function("ping") {
      42
    }

    // 用複習歷史訓練 FSRS 參數。計算密集 → AsyncFunction（背景執行緒）。
    // 輸入/輸出皆 JSON 字串，透過 JNI 呼叫 Rust。
    AsyncFunction("optimize") { inputJson: String ->
      FsrsNativeRust.optimize(inputJson)
    }
  }
}
