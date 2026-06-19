package expo.modules.fsrsnative

/**
 * 載入 Rust 共享庫並橋接 JNI。
 * libfsrs_mobile.so（src/main/jniLibs/<abi>/）由 native/fsrs-rust 以 cargo-ndk 產出。
 * optimize 的 JNI 符號 = Java_expo_modules_fsrsnative_FsrsNativeRust_optimize（須與 Rust 端一致）。
 */
object FsrsNativeRust {
  init {
    System.loadLibrary("fsrs_mobile")
  }

  /** 輸入訓練 JSON，回傳結果 JSON（{ok,w,error}）。計算密集，呼叫端請於背景執行。 */
  external fun optimize(inputJson: String): String
}
