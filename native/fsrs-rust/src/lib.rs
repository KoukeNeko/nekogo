//! fsrs_mobile — Rust 端，供 RN 原生模組透過 C ABI 呼叫。
//!
//! 提供兩支 C 函式：
//!   - `fsrs_native_ping()`：工具鏈探針（Slice 0）。
//!   - `fsrs_optimize(json)`：用使用者複習歷史訓練 FSRS 參數（Slice 1），回傳 JSON。
//!
//! 訓練由 fsrs 6.6.1 的 `compute_parameters` 完成（純 ndarray/rayon CPU，無 GPU/Burn）。

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};

use fsrs::{compute_parameters, ComputeParametersInput, FSRSItem, FSRSReview};
use serde::{Deserialize, Serialize};

/// 工具鏈探針：固定回傳 42。
#[no_mangle]
pub extern "C" fn fsrs_native_ping() -> c_int {
    42
}

// ---- JSON 介面 ----

#[derive(Deserialize)]
struct ReviewIn {
    /// 1–4（Again/Hard/Good/Easy）。
    rating: u32,
    /// 距上次複習的天數；每張卡第一筆必須為 0。
    #[serde(alias = "deltaT")]
    delta_t: u32,
}

#[derive(Deserialize)]
struct ItemIn {
    reviews: Vec<ReviewIn>,
}

#[derive(Deserialize)]
struct OptimizeIn {
    items: Vec<ItemIn>,
}

#[derive(Serialize)]
struct OptimizeOut {
    ok: bool,
    /// 訓練出的參數（w）；失敗時為空。
    w: Vec<f32>,
    /// 失敗原因；成功時為 None。
    error: Option<String>,
}

impl OptimizeOut {
    fn err(message: impl Into<String>) -> Self {
        OptimizeOut { ok: false, w: Vec::new(), error: Some(message.into()) }
    }
}

/// 純 Rust 入口（給單元測試直接用，不經 C ABI）。
fn run_optimize(input_json: &str) -> OptimizeOut {
    let parsed: OptimizeIn = match serde_json::from_str(input_json) {
        Ok(value) => value,
        Err(error) => return OptimizeOut::err(format!("JSON 解析失敗: {error}")),
    };

    let train_set: Vec<FSRSItem> = parsed
        .items
        .into_iter()
        .map(|item| FSRSItem {
            reviews: item
                .reviews
                .into_iter()
                .map(|review| FSRSReview { rating: review.rating, delta_t: review.delta_t })
                .collect(),
        })
        // 過濾無效卡：fsrs 要求每張卡至少一筆 delta_t>0（否則 current() 直接 panic），
        // 且所有評分須為 1-4（否則 compute_parameters 回 InvalidInput 整批失敗）。
        // 真實 revlog 必有只複習一次的新卡，這道過濾是必要防護。
        .filter(|item| {
            item.reviews.iter().all(|review| (1..=4).contains(&review.rating))
                && item.reviews.iter().any(|review| review.delta_t > 0)
        })
        .collect();

    match compute_parameters(ComputeParametersInput { train_set, ..Default::default() }) {
        Ok(weights) => OptimizeOut { ok: true, w: weights, error: None },
        Err(error) => OptimizeOut::err(format!("{error:?}")),
    }
}

/// 共用核心：吃 JSON 字串、回 JSON 字串（panic-safe）。C ABI 與 JNI 皆用此。
fn run_optimize_json(input_json: &str) -> String {
    let result = std::panic::catch_unwind(|| run_optimize(input_json))
        .unwrap_or_else(|_| OptimizeOut::err("訓練過程 panic"));
    serde_json::to_string(&result).unwrap_or_else(|_| "{\"ok\":false,\"w\":[]}".to_string())
}

/// C ABI（iOS）：輸入 JSON（`{"items":[{"reviews":[{"rating","deltaT"}...]}...]}`），
/// 回傳 JSON 字串 `{"ok","w","error"}`。回傳的指標需由 `fsrs_free` 釋放。
#[no_mangle]
pub extern "C" fn fsrs_optimize(input_json: *const c_char) -> *mut c_char {
    let json = if input_json.is_null() {
        serde_json::to_string(&OptimizeOut::err("輸入為 null")).unwrap_or_default()
    } else {
        let input = unsafe { CStr::from_ptr(input_json) }.to_string_lossy().into_owned();
        run_optimize_json(&input)
    };
    // unwrap_or：serde_json 產出的字串不含內嵌 NUL；萬一失敗給最簡 JSON。
    CString::new(json)
        .unwrap_or_else(|_| CString::new("{\"ok\":false,\"w\":[]}").unwrap())
        .into_raw()
}

/// Android（JNI）：對應 Kotlin
/// `package expo.modules.fsrsnative; object FsrsNativeRust { external fun optimize(json: String): String }`。
/// 函式名 = Java_<package 以 _ 分隔>_<類名>_<方法名>，務必與 Kotlin 端一致。
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_expo_modules_fsrsnative_FsrsNativeRust_optimize(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    input: jni::objects::JString,
) -> jni::sys::jstring {
    use std::ptr::null_mut;
    let input: String = match env.get_string(&input) {
        Ok(value) => value.into(),
        Err(_) => return null_mut(),
    };
    let output = run_optimize_json(&input);
    match env.new_string(output) {
        Ok(value) => value.into_raw(),
        Err(_) => null_mut(),
    }
}

/// 釋放 `fsrs_optimize` 回傳的字串。
#[no_mangle]
pub extern "C" fn fsrs_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe {
            drop(CString::from_raw(ptr));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_is_42() {
        assert_eq!(fsrs_native_ping(), 42);
    }

    #[test]
    fn optimize_small_returns_default_params() {
        // <8 items：compute_parameters 直接回 DEFAULT_PARAMETERS。
        let input = r#"{"items":[
            {"reviews":[{"rating":3,"deltaT":0},{"rating":3,"deltaT":1}]},
            {"reviews":[{"rating":4,"deltaT":0},{"rating":3,"deltaT":3}]}
        ]}"#;
        let out = run_optimize(input);
        assert!(out.ok, "預期成功，error={:?}", out.error);
        assert_eq!(out.w.len(), fsrs::DEFAULT_PARAMETERS.len());
        assert!(out.w.iter().all(|p| p.is_finite()));
    }

    #[test]
    fn single_review_items_are_filtered_not_panicked() {
        // 只複習一次的卡（只有 delta_t=0）會讓 fsrs panic；wrapper 必須先過濾。
        let input = r#"{"items":[
            {"reviews":[{"rating":3,"deltaT":0}]},
            {"reviews":[{"rating":3,"deltaT":0},{"rating":3,"deltaT":2}]}
        ]}"#;
        let out = run_optimize(input);
        assert!(out.ok, "應乾淨處理而非 panic，error={:?}", out.error);
        assert_eq!(out.w.len(), fsrs::DEFAULT_PARAMETERS.len());
    }

    #[test]
    fn optimize_c_abi_roundtrip() {
        let input =
            CString::new(r#"{"items":[{"reviews":[{"rating":3,"deltaT":0},{"rating":3,"deltaT":4}]}]}"#)
                .unwrap();
        let ptr = fsrs_optimize(input.as_ptr());
        assert!(!ptr.is_null());
        let json = unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned();
        fsrs_free(ptr);
        assert!(json.contains("\"ok\":true"), "輸出: {json}");
    }

    #[test]
    fn training_handles_large_dataset_gracefully() {
        // 造首評分散佈 1-4、間隔相關對錯的大量資料；驗證「不 panic 且乾淨回傳」。
        // 合成資料未必足以初始化（可能回 NotEnoughData）——重點是不崩、回傳乾淨。
        let mut train_set = Vec::new();
        for index in 0..2000u32 {
            let first_rating = 1 + (index % 4);
            let mut reviews = vec![FSRSReview { rating: first_rating, delta_t: 0 }];
            for step in 1..4u32 {
                let delta_t = 1 + step * 2 + index % 5;
                let rating = if delta_t < 6 { 3 } else if delta_t < 10 { 2 } else { 1 };
                reviews.push(FSRSReview { rating, delta_t });
            }
            train_set.push(FSRSItem { reviews });
        }
        match compute_parameters(ComputeParametersInput { train_set, ..Default::default() }) {
            Ok(weights) => {
                assert_eq!(weights.len(), fsrs::DEFAULT_PARAMETERS.len());
                assert!(weights.iter().all(|p| p.is_finite()));
                println!("training ok: w.len()={}", weights.len());
            }
            Err(error) => {
                println!("training 乾淨回傳 Err（非 panic）: {error:?}");
            }
        }
    }
}
