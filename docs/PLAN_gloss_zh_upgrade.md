# PLAN — 中文釋義升級 P0（gloss_zh）

## Context（要解決的問題）

Nekogo 現有 ~51,771 筆 `vocab.gloss_zh` 是「英譯轉譯」——把 DB 的英文 `gloss` 用 Haiku
翻成中文。實測有系統性壞譯，尤其副詞/虛詞/感嘆詞：

| 詞 | 現存中文 | 問題 |
|---|---|---|
| 強いて（しいて, 副詞） | 勉強；硬是 | 「勉強」是看起來像日文「讀書」的**假朋友** |
| 日中（にっちゅう） | 白天；白日間 | 「白日間」不通；且**丟失**了「日本與中國」義 |
| どう（感嘆, 停馬聲） | 籲（用來停止馬的指令等） | 「籲」生僻錯字 |
| あの | 嗯；好吧；嗯 | **重複**（LLM MT 典型錯誤） |

### 兩個獨立根因（已用資料驗證）

1. **多義詞截斷**：`build-content-db.mjs` 只取 JMdict `sense[0]`，**47% 的 JLPT 詞**（3497/7394）
   在 JMdict 有 >1 英文義項卻被砍到只剩首義。完整義項仍在 `.cache/jmdict-eng-full.json`。
2. **輸入太貧 + 無防呆**：現 prompt 只給 `word/reading/gloss_en`，無 pos、無例句、無 one-shot、
   無假朋友警告。研究實證：餵完整語境比裸 gloss 品質高（+17 BLEU），one-shot 可消除重複。

## High-Level Design

**不重建 DB、不動英文 `gloss` 欄**。改為在**翻譯當下**：

- **輸入增強**：以 `vocab.id`（= JMdict word id）從 `.cache/jmdict-eng-full.json` 撈**完整義項
  （全部 sense 的英文 gloss + 全部 pos）**；tanos 合成詞（`t-*`）退回 DB gloss。
- **提示重寫**：翻「**日文詞本身**」（給 word/reading/pos/完整英文/可選例句），英文僅提示之一；
  台灣繁中；辭典風格；one-shot；**假朋友警告**；副詞/虛詞/感嘆詞指引；禁止重複義項。
- **模型升級**：Haiku 4.5 → **Sonnet**。

## Step-by-Step

1. **Harness（先做）**：`scripts/etl/verify-gloss-prompt.mjs` — 對難詞批次同跑舊 vs 新 prompt，
   並排印出，**不寫 DB**。人工驗證。
2. 改 `translate-zh.mjs`：JMdict cache 增強 + 新 SYSTEM_PROMPT + one-shot；預設模型 Sonnet。
3. 重跑範圍（待核准）：A 只高風險詞性（數千）／B +多義截斷詞（數萬）／C 全部（51,771）。建議 A 先。
4. 驗證 + DB bump v16。

## Verification

- Harness 並排 old/new，人工確認難詞。
- 重跑後確定性檢查（重複/日中混雜/過短/中英同字）+ 抽樣 + 上機驗點名詞。

## 前置

- `ANTHROPIC_API_KEY`。
