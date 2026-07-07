// 內容庫繁中翻譯（第二階段：LLM 補全）。
//
// 翻譯兩類內容成台灣繁體中文，直接寫回 assets/db/kioku-content.db：
//   - vocab.gloss_zh：翻「日文詞」本身（餵 word+reading+pos+完整 JMdict 義項；防假朋友；intro_rank 順序）
//   - example.zh   ：例句（從日文原句直翻、英文當參考；Tatoeba 人譯已先由 build-example-zh.mjs 填入）
//
// 冪等 & 可續跑：只選 IS NULL 的列、逐批 UPDATE；中斷重跑會從缺的繼續。
// 用法：
//   ANTHROPIC_API_KEY=sk-... node scripts/etl/translate-zh.mjs --target vocab|example|all [--limit N]
//   --limit N     只翻前 N 筆（煙霧測試用）
//   --rebuild     全量重譯 vocab 至暫存欄 gloss_zh_v2（不動現有 gloss_zh、可續跑）
//   --promote     把 gloss_zh_v2 覆寫回 gloss_zh（重譯驗收後執行；不需 API key）
//
// 模型：claude-sonnet-5（MODEL 環境變數可覆蓋）。關閉 thinking（Sonnet 5 拒非預設 temperature）、嚴格 JSON 輸出。

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SCRIPT_DIR, '..', '..');
const CACHE_DIR = join(SCRIPT_DIR, '.cache');
const CONTENT_DB_PATH = join(APP_ROOT, 'assets', 'db', 'kioku-content.db');

const API_URL = 'https://api.anthropic.com/v1/messages';
// Sonnet 5：日中語感較 Haiku 穩，且支援關閉 thinking（機械式翻譯不需推理，省 token）。
const MODEL = process.env.MODEL ?? 'claude-sonnet-5';
const BATCH_SIZE = 40;
const CONCURRENCY = 6;
const MAX_RETRIES = 5;
// Sonnet 5 定價（USD / M tokens；導入價 $2/$10 至 2026-08-31，此處用標準價避免低估）。僅供進度顯示。
const PRICE_IN_PER_M = 3;
const PRICE_OUT_PER_M = 15;

const SYSTEM_PROMPT = `你是專業的日中辭典編輯，替台灣的日語學習者撰寫辭典釋義。

規則：
- 一律使用台灣慣用的繁體中文用語（例：影片不用視頻、品質不用質量、軟體不用軟件、程式不用程序）。
- 翻譯「日文詞」本身，而非字面翻英文：以 word/reading/pos 判定語意，英文 senses_en 僅為輔助提示。
- 慎防「假朋友」：日文漢字詞的中文常與字面不同（日文「勉強」＝學習、中文「勉強」＝硬要；日文「大丈夫」＝沒問題）。務必譯出該日文詞的實際意義，不可照抄漢字。
- vocab（詞義）：辭典風格、精簡；多個義項以「；」分隔，涵蓋主要義項；不加句號結尾；不重複同義詞；不把日文詞本身當譯文。
- 副詞／虛詞／感嘆詞：譯出功能與語感，勿硬套名詞（例：どう〔喝止馬〕＝吁；えっと＝嗯…（張口思考的發語詞））。
- example（例句）：以日文原句為準直接翻譯（英文僅供參考），口語自然、忠實原意。
- 只輸出 JSON 陣列，格式：[{"id": <id>, "zh": "<翻譯>"}, ...]，不要任何其他文字。

vocab 範例（供格式與風格參考）：
輸入：[{"id":1,"word":"強いて","reading":"しいて","pos":"adv","senses_en":["by force"]}]
輸出：[{"id":1,"zh":"硬要；勉強地說；刻意"}]`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    target: get('--target') ?? 'all',
    limit: get('--limit') ? Number(get('--limit')) : Infinity,
    // --rebuild：全量重譯 vocab 至暫存欄 gloss_zh_v2（可續跑、不動現有 gloss_zh）。
    // --promote：把 gloss_zh_v2 覆寫回 gloss_zh（重譯驗收後執行）。
    rebuild: args.includes('--rebuild'),
    promote: args.includes('--promote'),
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let totalIn = 0;
let totalOut = 0;

/** 呼叫 Anthropic Messages API，回傳文字內容；429/5xx 指數退避重試。 */
const callClaude = async (userContent) => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        // Sonnet 5 拒絕非預設 temperature（原 temperature:0 會 400）；改以關閉 thinking 求穩定：
        // 機械式辭典翻譯不需推理，關閉可省 token、避免 adaptive thinking 預設開啟。
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (response.ok) {
      const data = await response.json();
      totalIn += data.usage?.input_tokens ?? 0;
      totalOut += data.usage?.output_tokens ?? 0;
      return data.content?.[0]?.text ?? '';
    }
    if (response.status === 429 || response.status >= 500) {
      const wait = Math.min(2 ** attempt * 1000, 30000);
      await sleep(wait);
      continue;
    }
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  throw new Error('API 重試次數用盡');
};

/** 解析模型輸出的 JSON 陣列（容忍 ```json 圍欄）。 */
const parseBatchResult = (text) => {
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('回應不是 JSON 陣列');
  return parsed;
};

// JMdict 完整義項索引：id → { senses:[英文義項…], pos }。
// DB 的 vocab.gloss 只存了首義（build-content-db 取 sense[0]），47% 多義詞被截斷；
// 翻譯時改從 cache 撈完整義項餵給模型，讓多義詞不再遺漏。首次呼叫才載入（~1-2s）。
let jmdictIndex = null;
const loadJmdictIndex = () => {
  if (jmdictIndex) return jmdictIndex;
  jmdictIndex = new Map();
  const dict = JSON.parse(readFileSync(join(CACHE_DIR, 'jmdict-eng-full.json'), 'utf-8'));
  const posTags = dict.tags ?? {};
  for (const word of dict.words) {
    const senses = [];
    const posSet = new Set();
    for (const sense of word.sense ?? []) {
      const gloss = (sense.gloss ?? []).filter((g) => g.lang === 'eng').map((g) => g.text).join('; ');
      if (gloss) senses.push(gloss);
      for (const code of sense.partOfSpeech ?? []) posSet.add(posTags[code] ?? code);
    }
    if (senses.length > 0) jmdictIndex.set(word.id, { senses, pos: [...posSet].join(', ') });
  }
  return jmdictIndex;
};

const translateVocabBatch = async (rows) => {
  const index = loadJmdictIndex();
  const items = rows.map((row) => {
    // JMdict 詞（id 為 JMdict word id）取完整義項；tanos 合成詞（t-*，無 JMdict entry）退回 DB 首義。
    const enriched = index.get(row.id);
    return {
      id: row.id,
      word: row.expression,
      reading: row.reading,
      pos: enriched?.pos ?? row.pos ?? '',
      senses_en: enriched?.senses ?? [row.gloss],
    };
  });
  const prompt =
    `翻譯下列日文單字為台灣繁體中文辭典釋義。欄位：word=詞、reading=讀音、pos=詞性、senses_en=完整英文義項（可能多個，代表不同義項）。\n` +
    `請翻「日文詞」本身：以 word+reading+pos 判定語意，senses_en 為輔助；多義項以「；」分隔並涵蓋主要義項。\n\n` +
    JSON.stringify(items, null, 0);
  return parseBatchResult(await callClaude(prompt));
};

const translateExampleBatch = async (rows) => {
  const items = rows.map((row) => ({ id: row.id, jp: row.jp, en_ref: row.en }));
  const prompt = `把下列日文例句翻成台灣繁體中文（以 jp 為準，en_ref 僅供參考）：\n${JSON.stringify(items, null, 0)}`;
  return parseBatchResult(await callClaude(prompt));
};

/** 以固定並行度跑批次，逐批寫回 DB。 */
const runTarget = async (db, { label, rows, translateBatch, update }) => {
  if (rows.length === 0) {
    console.log(`${label}：無待翻項目，略過。`);
    return;
  }
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));
  console.log(`${label}：待翻 ${rows.length} 筆（${batches.length} 批，每批 ${BATCH_SIZE}）`);

  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < batches.length) {
      const index = cursor;
      cursor += 1;
      const batch = batches[index];
      try {
        const results = await translateBatch(batch);
        // 以字串為 key：vocab id 含 tanos 合成詞（t-*），Number() 會全變 NaN 而互相覆蓋。
        const byId = new Map(results.map((r) => [String(r.id), String(r.zh ?? '').trim()]));
        db.exec('BEGIN');
        for (const row of batch) {
          const zh = byId.get(String(row.id));
          if (zh) update.run(zh, row.id);
        }
        db.exec('COMMIT');
        done += batch.length;
      } catch (error) {
        failed += batch.length;
        console.error(`批次 ${index} 失敗（跳過，重跑腳本可補）：${error.message?.slice(0, 200)}`);
      }
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / elapsed;
      const eta = rate > 0 ? Math.round((rows.length - done) / rate / 60) : '?';
      const cost = (totalIn / 1e6) * PRICE_IN_PER_M + (totalOut / 1e6) * PRICE_OUT_PER_M;
      process.stdout.write(
        `\r${label}: ${done}/${rows.length}（失敗 ${failed}）  ETA ~${eta} 分  累計成本 ~$${cost.toFixed(2)}   `,
      );
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');
};

const ensureColumn = (db, table, column) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    console.log(`已新增 ${table}.${column} 欄位`);
  }
};

const run = async () => {
  if (!existsSync(CONTENT_DB_PATH)) {
    console.error(`❌ 找不到內容庫：${CONTENT_DB_PATH}`);
    process.exit(1);
  }
  const { target, limit, rebuild, promote } = parseArgs();

  // --promote：把重譯結果 gloss_zh_v2 覆寫回 gloss_zh（不需 API key）。驗收後執行。
  if (promote) {
    const db = new DatabaseSync(CONTENT_DB_PATH);
    const cols = db.prepare('PRAGMA table_info(vocab)').all();
    if (!cols.some((c) => c.name === 'gloss_zh_v2')) {
      console.error('❌ 無 gloss_zh_v2 欄位，尚未重譯，無可提升。');
      process.exit(1);
    }
    db.exec("UPDATE vocab SET gloss_zh = gloss_zh_v2 WHERE gloss_zh_v2 IS NOT NULL AND gloss_zh_v2 != ''");
    const promoted = db.prepare("SELECT COUNT(*) AS c FROM vocab WHERE gloss_zh_v2 IS NOT NULL AND gloss_zh_v2 != ''").get().c;
    db.close();
    console.log(`✅ 已提升 ${promoted} 筆 gloss_zh_v2 → gloss_zh。（欄位 gloss_zh_v2 保留，供比對；確認無誤後可另行 DROP。）`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 請設定 ANTHROPIC_API_KEY 環境變數');
    process.exit(1);
  }
  const db = new DatabaseSync(CONTENT_DB_PATH);
  ensureColumn(db, 'vocab', 'gloss_zh');
  ensureColumn(db, 'example', 'zh');

  const limitSql = Number.isFinite(limit) ? ` LIMIT ${limit}` : '';

  if (target === 'vocab' || target === 'all') {
    // 常用詞先翻（intro_rank 升冪），中斷時已翻的都是最有價值的部分。
    // rebuild：全量重譯寫入暫存欄 gloss_zh_v2（以 v2 IS NULL 續跑、不動現有 gloss_zh）。
    // 一般：只補未翻（gloss_zh IS NULL）。
    const col = rebuild ? 'gloss_zh_v2' : 'gloss_zh';
    if (rebuild) ensureColumn(db, 'vocab', 'gloss_zh_v2');
    const rows = db
      .prepare(`SELECT id, expression, reading, gloss, pos FROM vocab WHERE ${col} IS NULL ORDER BY intro_rank IS NULL, intro_rank${limitSql}`)
      .all();
    await runTarget(db, {
      label: rebuild ? 'vocab 詞義（重譯→v2）' : 'vocab 詞義',
      rows,
      translateBatch: translateVocabBatch,
      update: db.prepare(`UPDATE vocab SET ${col} = ? WHERE id = ? AND ${col} IS NULL`),
    });
  }

  // rebuild 只針對 vocab；例句已近全譯，重譯屬另一回事，跳過。
  if (!rebuild && (target === 'example' || target === 'all')) {
    const rows = db.prepare(`SELECT id, jp, en FROM example WHERE zh IS NULL${limitSql}`).all();
    await runTarget(db, {
      label: 'example 例句',
      rows,
      translateBatch: translateExampleBatch,
      update: db.prepare('UPDATE example SET zh = ? WHERE id = ? AND zh IS NULL'),
    });
  }

  const glossCol = rebuild ? 'gloss_zh_v2' : 'gloss_zh';
  const glossDone = db.prepare(`SELECT COUNT(*) AS c FROM vocab WHERE ${glossCol} IS NOT NULL AND ${glossCol} != ''`).get().c;
  const glossTotal = db.prepare('SELECT COUNT(*) AS c FROM vocab').get().c;
  const zhDone = db.prepare("SELECT COUNT(*) AS c FROM example WHERE zh IS NOT NULL AND zh != ''").get().c;
  const zhTotal = db.prepare('SELECT COUNT(*) AS c FROM example').get().c;
  db.close();
  console.log(`\n覆蓋率：${glossCol} ${glossDone}/${glossTotal}、example.zh ${zhDone}/${zhTotal}`);
  console.log(`token 用量：in ${totalIn}、out ${totalOut}`);
  if (rebuild) console.log('提示：重譯寫入 gloss_zh_v2。抽樣驗收後，執行 `node translate-zh.mjs --promote` 覆寫回 gloss_zh。');
};

run();
