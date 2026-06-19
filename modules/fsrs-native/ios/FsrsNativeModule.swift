import ExpoModulesCore
import FsrsMobile // Clang module（FsrsMobile.xcframework）：fsrs_native_ping / fsrs_optimize / fsrs_free

public class FsrsNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FsrsNative")

    // 工具鏈探針（同步、極輕量）。
    Function("ping") { () -> Int in
      Int(fsrs_native_ping())
    }

    // 用複習歷史訓練 FSRS 參數。計算密集 → AsyncFunction（背景執行緒）。
    // 輸入/輸出皆為 JSON 字串，避免跨橋傳遞複雜結構。
    AsyncFunction("optimize") { (inputJson: String) -> String in
      guard let result = fsrs_optimize(inputJson) else {
        return "{\"ok\":false,\"w\":[],\"error\":\"null result\"}"
      }
      defer { fsrs_free(result) }
      return String(cString: result)
    }
  }
}
