# Nekogo 學習流程與運作方式

> 本文說明 Nekogo（Kioku）目前的學習系統如何運作：卡片從哪來、如何進入學習、
> 速讀與閃卡兩種模式各做什麼、FSRS 如何排程、每日配額與統計如何計算。
> 所有描述皆對照原始碼（`檔案:行號`），為 v19 內容庫時的實作快照。

---

## 1. 總覽（TL;DR）

Nekogo 採 **「速讀優先（skim-first）」** 的雙軌學習模型：

- **新字只能從速讀（スキミング / Skim）進入。** 速讀是「分流／triage」：一眼掃過，
  決定這個字是「已經會了」還是「要學」。
- **閃卡（フラッシュカード / Flashcard）只複習已學過、到期的卡**，永遠不引入新字。
- 排程由 **FSRS-6（ts-fsrs）** 在裝置端計算；累積足夠複習紀錄後，可用內建的
  **原生優化器（fsrs-rs, Rust）** 訓練個人化參數。

一句話流程：

```
內容庫（唯讀）──種卡──▶ 新卡(state 0)
                              │
                     速讀 スキミング
                     ├─「知ってる」= Easy ─▶ 直接畢業成 複習卡(state 2)（不佔每日配額）
                     └─「学習する」= Good ─▶ 進入 學習中(state 1)（佔每日配額，上限 20）
                              │
                   到期後 ⏰ due ≤ now
                              │
                     閃卡 フラッシュカード（複習）
                     Again / Hard / Good / Easy ─▶ FSRS 重新排下次到期日
```

---

## 2. 架構：雙資料庫

系統由兩個 SQLite 資料庫組成，啟動時把唯讀內容庫 `ATTACH` 到使用者主庫旁。

| 資料庫 | 可寫 | 內容 | 定義位置 |
|---|---|---|---|
| **使用者主庫** | ✅ 可寫 | `cards`（FSRS 狀態）、`revlog`（每次複習紀錄）、`kv`（設定，如選取牌組、FSRS 參數） | `src/db/schema.ts`（`cards` `:30-48`、`revlog` `:64-79`、`kv` `:88-93`） |
| **內容庫（content）** | 🔒 唯讀 | `vocab`、`example`、`kanji`、`decks`、`deck_vocab`…（詞條、例句、漢字、牌組） | 預建 SQLite，`assets/db/kioku-content.db` |

- **內容庫版本**：`CONTENT_DB_FILE = 'kioku-content-v19.db'`（`src/db/contentDb.ts:29`）。
  bump 版本會強制重新複製到裝置，不動使用者主庫。舊版檔案由 `STALE_CONTENT_DB_FILES`
  （`contentDb.ts:31-47`）在複製新版後刪除，避免殘留 ~134MB 孤兒檔。
- **首次複製**：`ensureContentDbCopied()`（`contentDb.ts:53-68`）用原生檔案複製把
  bundle 內的 db 拷進 `documentDirectory`（不經 JS 記憶體）。
- **掛載**：`attachContentDb()`（`contentDb.ts:71-90`）執行 `ATTACH DATABASE … AS content`；
  別名常數 `CONTENT_ALIAS = 'content'`（`contentDb.ts:20`）。ATTACH 不跨行程存活，
  每次冷啟重跑（冪等）。跨庫查詢如 `cards c JOIN content.vocab v`。
- **另一個版本字串**：API 層 `CONTENT_VERSION = 'v5'`（`src/api/contentApi.ts:16`）是舊後端
  相容用的獨立字串，與內容庫檔名 v19 屬不同編號體系。
- **「雲端」是假名**：`contentApi.ts` 中 `fetchDeckMembers`、`fetchVocabByIds` 等雖以
  `async`/`fetch` 命名，實際上都是對 `content.*` 的本地 `executeSync` 查詢
  （`contentApi.ts:9-13, 223-231`）——**完全離線**，命名只是沿用舊 Go 後端簽章。

---

## 3. 卡片生命週期（狀態機）

卡片的 `state` 欄採 ts-fsrs 的 `State` 列舉：

| state | 意義 | 如何進入 |
|---|---|---|
| `0` | **New（新卡）** | 種卡時建立（`createEmptyCard`） |
| `1` | **Learning（學習中）** | 速讀選「学習する」(Good)，或複習被評為需再練 |
| `2` | **Review（複習）** | 速讀選「知ってる」(Easy) 直接畢業，或學習畢業 |
| `3` | **Relearning（重新學習）** | 複習卡被評為 Again（遺忘） |

```
                ┌─────────────────────────────────────────────┐
                │                內容庫 vocab                    │
                └───────────────────┬─────────────────────────┘
                            種卡 seed.ts（離線、增量）
                                    ▼
                          ┌──────────────────┐
                          │  state 0 : New    │  ← 只出現在速讀佇列
                          └───────┬──────────┘
             速讀「知ってる」Easy   │   速讀「学習する」Good
              （不佔配額）          │    （佔每日 20 配額）
                    ▼               ▼
          ┌──────────────┐   ┌────────────────┐
          │ state 2 Review│   │ state 1 Learning│
          └──────┬───────┘   └───────┬────────┘
                 │      到期 due ≤ now │
                 └─────────┬──────────┘
                           ▼
                 閃卡複習（Again/Hard/Good/Easy）
             Again ─▶ state 3 Relearning ；其餘 ─▶ 重排 due
```

**卡片資料模型**（`schema.ts:30-48`，表 `cards`）：

- FSRS 狀態欄：`due`（epoch ms）、`stability`、`difficulty`、`elapsed_days`、
  `scheduled_days`、`reps`、`lapses`、`state`、`last_review`（epoch ms，可為 null）。
- 非 FSRS 欄：`id`（`card-${vocab_id}`）、`vocab_id`（→ `content.vocab`）、`deck_id`、
  `intro_rank`（新卡引入順序，可 null）、`bookmarked`、`suspended`。

新卡初始狀態由 `createNewCard()`（`src/services/fsrs.ts:23-25`）＝ ts-fsrs `createEmptyCard()`
產生：`state=0`、`due=now`、reps/lapses=0、`last_review=null`。

---

## 4. 每日學習流程與首頁閘門

### 種卡（Seeding）

- `ensureSelectedDeckCards()`（`src/db/seed.ts:59-91`）從內容庫 `deck_vocab` 讀成員，
  以 `INSERT OR IGNORE INTO cards`（冪等、增量）批次建卡，每批 `SEED_BATCH_SIZE = 2000`。
- **首次啟動只種預設 JLPT 範圍**：`DEFAULT_SEED_DECK_IDS = ['deck-n1'…'deck-n5']`
  （`seed.ts:23`），約 7,965 張卡，而非全庫 ~20 萬。
- 觸發時機：冷啟（`_layout.tsx:46`）、首頁確認牌組（`index.tsx:112`）、開啟特定牌組
  （`deck/[id].tsx:57`）。

### 牌組選取（學習範圍）

- `getSelectedDecks()` / `setSelectedDecks()`（`src/db/repositories/selectedDecksRepository.ts:9-27`），
  存於 `kv` 表 key `'selected_decks'`（JSON 陣列）。**空陣列＝全部（「すべて」）。**
- 首頁 AppBar 的下拉多選面板即操作此設定（`index.tsx:105-137`）。

### 首頁指標與閘門（`src/app/(tabs)/index.tsx`）

`getDailyMetrics()` 提供三個數字，首頁進度環與模式卡片依此運作：

- `skimDone = metricsLoaded && metrics.newCards === 0`（`index.tsx:141`）
  → 當天新卡都分完，**速讀卡片變灰、顯示「今日完了」**（`index.tsx:234-248`）。
- `skimPending = metricsLoaded && metrics.newCards > 0`（`index.tsx:144`）
  → 當天還有新卡未分，**閃卡卡片鎖定、顯示「ロック中／先にスキミングを完了してください」**
  （`index.tsx:271-288`）。這實作了「速讀優先」：必須先把新卡速讀分完才能複習。

| 狀態 | 速讀 スキミング | 閃卡 フラッシュカード |
|---|---|---|
| 當天**還有新卡** | 🟠 可按 | 🔒 鎖住（ロック中） |
| 新卡**全部分完** | ⬜ 今日完了（停用） | 🟠 解鎖可按 |

---

## 5. 速讀模式（スキミング）

**入口**：首頁 `router.push('/skim')`（`index.tsx:250`）。畫面 `src/app/skim.tsx`。

### 取卡

- `getSkimQueue(20, deckId?)`（`cardRepository.ts:179-201`）：
  `WHERE c.state = 0 AND c.suspended = 0 [牌組範圍] ORDER BY c.intro_rank IS NULL, c.intro_rank ASC LIMIT 20`。
- **只取新卡（state 0）**，依引入順序 `intro_rank`（null 排最後）。
- **速讀佇列刻意不套用每日配額**（`cardRepository.ts:177-178`）——速讀是分流，可一次掃很多，
  「已會」的用 Easy 濾掉不佔額度。

### 兩個動作（`skim.tsx:154-164`）

| 按鈕 | 評分 | 效果 | 佔每日配額？ |
|---|---|---|---|
| **「知ってる」**（綠勾） | `Rating.Easy` (4) | `skimMarkKnown`（`cardRepository.ts:204-207`）→ 新卡直接畢業成 **複習卡(state 2)**，到期日推遠 | ❌ 不佔 |
| **「学習する」**（橘書） | `Rating.Good` (3) | `skimMarkLearning`（`cardRepository.ts:210-213`）→ 進入 **學習中(state 1)**，短間隔內會回到閃卡 | ✅ 佔 |

兩者都經 `updateCardState`（`cardRepository.ts:215-252`）：**寫回完整 FSRS 狀態到 `cards`**
＋**插入一筆 `revlog`**（`review_time=now`、`duration_ms=0`）。
所以速讀不只是打標籤，而是實際跑 FSRS 排程並記錄複習日誌。

### 每日新卡配額

- `DAILY_NEW_LIMIT = 20`（`cardRepository.ts:49`）。
- `countNewIntroducedToday()`（`cardRepository.ts:54-71`）：從 `revlog` 取每張卡**最早一筆**複習，
  計入「日期為今天**且**首次評分 ≠ Easy(4)」者——所以 Easy（已會）不消耗配額，只有 Good（要學）算。
- 配額在畫面層強制：`handleNext`（`skim.tsx:42-63`）每次動作後重讀 `getDailyNewProgress()`，
  `learned >= limit` 就停止前進；AppBar 顯示 `{learned} / {limit}`（`skim.tsx:126`）。

### 結束

- 達標：`learned >= limit` → 「今日の新規目標達成！🎉」＋返回（`skim.tsx:82,93-103`）。
- 無卡：佇列空且未達標 → 「新しい単語はありません」＋返回（`skim.tsx:83,105-114`）。
- 佇列用盡但未達標時自動再抓一批 `getSkimQueue(20)`（`skim.tsx:50-59`）。
- 結束一律 `router.back()` 回首頁，無獨立總結頁。

---

## 6. 閃卡複習模式（フラッシュカード）

**入口**：首頁 `router.push('/review')`（`index.tsx:261`）。畫面 `src/app/review.tsx`
＋邏輯 `src/hooks/useReviewSession.ts`。（`review.tsx` 也兼字典模式：帶 `vocabId` 時單卡、無評分。）

### 取卡（只複習到期卡）

- `getDueCards(0, 50, deckId)`（呼叫點 `useReviewSession.ts:62, 173`；簽章
  `getDueCards(newLimit=20, reviewLimit=50, deckId?)` 於 `cardRepository.ts:126`）。
- **`newLimit = 0`** 是關鍵：讓複習「只複習、不引入新卡」（`useReviewSession.ts:61` 註解）。
- 到期查詢（`cardRepository.ts:137-140`）：
  `WHERE c.state > 0 AND c.suspended = 0 AND c.due <= now [牌組] ORDER BY c.due ASC LIMIT 50`。
  「到期」＝ `due <= Date.now()`，最早到期者優先。
- 新卡分支因 `newLimit=0` → `remainingNew=0` → 永遠空陣列（`cardRepository.ts:143-151`）。
  **雙重保證：查詢要求 `state>0` 結構性排除新卡，且 `newLimit=0`。**

### 評分（`components/RatingButtons.tsx:24-29`）

四級 ts-fsrs `Rating`，各按鈕顯示預估下次間隔（`useReviewSession.ts:123-135` 用
`previewSchedule` 預覽 `f.repeat`）：

| 按鈕 | Rating | 意義 |
|---|---|---|
| もう一度 | `Again` (1) | 忘了 → 進 Relearning |
| 難しい | `Hard` (2) | 勉強想起 |
| 普通 | `Good` (3) | 正常想起 |
| 簡単 | `Easy` (4) | 太簡單 |

按下 → `handleRate`（`useReviewSession.ts:137-165`）：
1. `processAnswer(fsrsCard, rating, now)`（`fsrs.ts:52-57`）＝ `f.repeat(card, now)[rating]`，
   取得新 FSRS 狀態與間隔。
2. 量測作答時間 `durationMs`（翻牌→評分，上限 `MAX_REVIEW_DURATION_MS = 60000`）。
3. `updateCardState(id, newFsrsCard, rating, durationMs)`（`cardRepository.ts:215-252`）——
   同樣**雙寫 `cards` ＋ `revlog`**。
4. `currentIndex + 1` 前進到下一張。

### 結束

- `isFinished = !isLoading && (deck.length === 0 || currentIndex >= deck.length)`
  （`useReviewSession.ts:87`）。
- 進度：AppBar 進度條 `currentIndex / totalCards`（`review.tsx:341-356`）。
- 完成畫面「複習完了！」＋「もう一度」重跑（`review.tsx:158-175`；`resetSession` 重抓
  `getDueCards(0,50,deckId)`）。**無自動導航**，使用者按 X → `router.back()`。

---

## 7. FSRS 排程與個人化優化器

### 排程引擎（`src/services/fsrs.ts`）

- 使用 **ts-fsrs `^5.4.1`**（`package.json:42`），裝置端計算。
- 模組級單例排程器 `f = fsrs()`（`fsrs.ts:15`）。
- `applyStoredParameters()`（`fsrs.ts:31-39`）：若 `kv` 有訓練好的權重就以
  `fsrs(generatorParameters({ w: weights }))` 重建，否則用預設。啟動時（`_layout.tsx:45`）
  與每次優化後（`fsrsOptimizer.ts:64`）呼叫。

### 個人化優化器（Rust 原生模組）

- 引擎：`modules/fsrs-native/`（`fsrs-rs` via Expo 原生模組），`optimize(items)` 於背景執行緒跑；
  **Expo Go 不可用，需 dev build**（`isAvailable()`）。
- `optimizeParameters()`（`src/services/fsrsOptimizer.ts:26-72`）：讀 `revlog`
  → `buildTrainingItems`（`fsrsTraining.ts:35-65`，按卡分組、算相鄰複習間隔 deltaT、
  只留評分 1–4）→ 原生 `optimize` → `storeParameters(w)` ＋ 重新套用。
- **門檻**：`MIN_REVIEWS_TO_OPTIMIZE = 1000`（`fsrsTraining.ts:13`）。
  `canOptimize()` ＝原生可用且 `revlog >= 1000`。
- **觸發**：**手動**，於設定頁按鈕（`src/app/settings.tsx:64-72`），未達 1000 筆前停用。非自動。
- 權重存於 `kv` 表 key `fsrs_params`（`fsrsParamsRepository.ts`），無硬編碼自訂 `w`。

---

## 8. 統計：連續天數／今日已複習／學習時間

全部由 `revlog` 推導（`cardRepository.ts`），並在 `statsRepository.ts` 聚合供統計頁使用。

- **`getStudyTimeStats()`**（`:258-272`）：今日 `SUM(duration_ms)` 與筆數，
  **排除**速讀畢業（`state=0 AND rating=4`）；另算全體 `AVG(duration_ms>0)`。
- **`getReviewedTodayCount()`**（`:275-282`）：今日 `COUNT(DISTINCT card_id)`，同樣排除速讀 Easy。
- **`getStreak()`**（`:292-313`）：由 `revlog` 的不重複本地日期，從今天往回數連續天數；
  今天沒複習但昨天有則從昨天起算，否則 0。
- 統計頁另計留存率（`rating>=2`）、young/mature（`scheduled_days` ≥/< 21）、各 JLPT 進度
  （`statsRepository.ts:79-89`）。

---

## 9. 關鍵常數一覽

| 常數 | 值 | 位置 | 作用 |
|---|---|---|---|
| `DAILY_NEW_LIMIT` | `20` | `cardRepository.ts:49` | 每日新卡引入上限（Good 才算） |
| `RATING_EASY` | `4` | `cardRepository.ts:53` | 速讀「已會」評分；不佔配額 |
| `getDueCards` newLimit（複習） | `0` | `useReviewSession.ts:62,173` | 閃卡只複習、不引入新卡 |
| `getDueCards` reviewLimit | `50` | `useReviewSession.ts:62,173` | 單場複習取卡上限 |
| `getSkimQueue` limit | `20` | `skim.tsx:24` | 速讀單批取卡數（不受每日配額限制） |
| `MAX_REVIEW_DURATION_MS` | `60000` | `useReviewSession.ts:7` | 單卡作答時間上限（防離開計時爆量） |
| `MIN_REVIEWS_TO_OPTIMIZE` | `1000` | `fsrsTraining.ts:13` | 可訓練個人化 FSRS 參數的門檻 |
| `SEED_BATCH_SIZE` | `2000` | `seed.ts:26` | 種卡批次大小 |
| `DEFAULT_SEED_DECK_IDS` | N1–N5 | `seed.ts:23` | 首次啟動預設種卡範圍（~7,965） |
| `CONTENT_DB_FILE` | `kioku-content-v19.db` | `contentDb.ts:29` | 內容庫版本檔名 |
| `CONTENT_ALIAS` | `content` | `contentDb.ts:20` | 內容庫 ATTACH 別名 |

---

## 10. 檔案索引

| 主題 | 檔案 |
|---|---|
| 首頁、指標、閘門、牌組選取 | `src/app/(tabs)/index.tsx` |
| 速讀畫面 | `src/app/skim.tsx` |
| 閃卡畫面 | `src/app/review.tsx` |
| 閃卡工作階段邏輯 | `src/hooks/useReviewSession.ts` |
| 取卡／評分／指標／統計（核心） | `src/db/repositories/cardRepository.ts` |
| FSRS 排程封裝 | `src/services/fsrs.ts` |
| FSRS 優化器（訓練流程） | `src/services/fsrsOptimizer.ts`、`src/services/fsrsTraining.ts` |
| FSRS 參數存取 | `src/db/repositories/fsrsParamsRepository.ts` |
| 原生優化引擎 | `modules/fsrs-native/` |
| 種卡 | `src/db/seed.ts` |
| 牌組選取存取 | `src/db/repositories/selectedDecksRepository.ts` |
| 內容庫複製／掛載／版本 | `src/db/contentDb.ts` |
| 內容查詢（離線 SQL） | `src/api/contentApi.ts` |
| 使用者主庫結構 | `src/db/schema.ts` |
| 統計聚合 | `src/db/repositories/statsRepository.ts` |
| 啟動順序 | `src/app/_layout.tsx` |

---

*文件產生時對照內容庫 v19；若日後改動取卡邏輯、配額或狀態機，請同步更新本文。*
