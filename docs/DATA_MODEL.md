# Nekogo 資料模型：以「單字」為樞紐關聯各資源

> 把散落的開放授權資源用 **`表記 + 讀音`** 這個 join key（jmdict `ent_seq` 為穩定主鍵）收斂成正規化關聯式內容庫。
> 由 `scripts/etl/build-content-db.mjs` 於 build 階段組好 → `assets/db/kioku-content.db`（唯讀，~18MB），App 以 op-sqlite `ATTACH` 為別名 `content` 跨庫 JOIN。
> `cards` / `revlog`（可變使用者狀態）留在主庫 `kioku.sqlite`；內容庫唯讀、可獨立改版。

## 關聯圖

```mermaid
erDiagram
    vocab ||--o{ vocab_kanji : "構成"
    kanji ||--o{ vocab_kanji : "出現於"
    vocab ||--o{ vocab_example : "例句"
    example ||--o{ vocab_example : "用於"
    vocab ||--o{ cards : "學習狀態"
    cards ||--o{ revlog : "複習紀錄"

    vocab {
        text id PK "jmdict ent_seq / t-* (tanos union)"
        text expression "表記（首選）"
        text reading "假名讀音"
        text furigana "JSON [{ruby,rt}] ← JmdictFurigana"
        text gloss "英文釋義 ← JMdict"
        text pos "詞性 ← JMdict"
        int jlpt "1-5（tanos），可為 null"
        int pitch "Kanjium 重音，可為 null"
        int is_jukugo "全為漢字=1"
        int is_common "jmdict-common=1"
    }
    kanji {
        text char PK
        text strokes "JSON string[] ← KanjiVG"
        int stroke_count
        int grade
        int jlpt
        int frequency
        text on_readings "JSON ← KANJIDIC2"
        text kun_readings "JSON"
        text meanings "JSON"
    }
    example {
        int id PK
        text jp
        text furigana "JSON [{ruby,rt}]（kuromoji+JmdictFurigana）"
        text en
    }
    vocab_kanji { text vocab_id FK; text char FK }
    vocab_example { text vocab_id FK; int example_id FK }
    cards {
        text id PK "card-<vocab_id>"
        text vocab_id FK
        text deck_id FK
        int due
        real stability
        real difficulty
        int state "0新 1學習 2複習 3再學習"
        int reps
        int lapses
        int last_review
    }
    revlog {
        int id PK
        text card_id FK
        int rating
        int state
        int review_time
    }
    decks { text id PK; text name; text tags; text color }
    decks ||--o{ cards : "包含"
```

## 各表來源與授權

| 表 / 欄 | 來源 | 授權 |
|---|---|---|
| `vocab`（expr/reading/gloss/pos）| jmdict-simplified eng-common（~2.26 萬）∪ tanos JLPT | CC BY-SA 4.0 / CC BY |
| `vocab.furigana` | JmdictFurigana | CC BY-SA 4.0 |
| `vocab.jlpt` | tanos.co.uk（open-anki-jlpt-decks）| CC BY / MIT |
| `vocab.pitch` | Kanjium（⚠️ 商用改 UniDic accType, BSD）| CC BY-SA 4.0（來源灰色）|
| `kanji` | KANJIDIC2 + KanjiVG | CC BY-SA 4.0 / 3.0 |
| `example` | Tanaka Corpus（furigana 用 kuromoji 產生）| CC BY 2.0 FR |
| `cards` / `revlog` / `decks` | App 產生（使用者狀態）| — |

## 設計重點

1. **一個 join key**：所有資源以 `表記+讀音` 對上 `vocab`；`vocab_kanji`、`vocab_example` 為 M:N 連結（漢字/例句被多詞共用）。
2. **熟語**：`is_jukugo = 1`（全為漢字的單字，含單漢字；目前 13,874 筆）→ 加 `WHERE is_jukugo=1` 即成熟語牌組，免新資料源。`vocab_kanji` 天然給每個熟語的構成漢字拆解。
3. **AI 圖片**（未來）：`vocab` 加一欄 `image_uri`（+ 來源/prompt）即可掛上；只對可圖像化的具體名詞生成。
4. **牌組 = 篩選**：deck-n{1..5} = `vocab WHERE jlpt = level`；未來可加「高頻 top-2k」「熟語」等篩選牌組。
5. **詞頻**（待做）：加 `vocab.freq_rank`（TUBELEX-JA BSD / jpstats CC0）→ 新卡 `ORDER BY freq_rank`（先學高頻）。

## 數量現況（2026-06）
vocab 23,629（JLPT 標記 7,877、熟語 13,874、furigana 77.6%、pitch 73.4%）、kanji 2,645、example 19,157、vocab_kanji 35,844、vocab_example 22,425。

## 重建
`npm run content`（download → build → verify）。驗證見 `scripts/verify-content-db.mjs`（外鍵零孤兒、furigana 不變性、JLPT 五級齊全）。
