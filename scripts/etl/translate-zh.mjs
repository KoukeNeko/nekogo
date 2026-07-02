// 內容庫繁中翻譯（第二階段：LLM 補全）。
//
// 翻譯兩類內容成台灣繁體中文，直接寫回 assets/db/kioku-content.db：
//   - vocab.gloss_zh：JMdict 英文釋義 → 辭典風格繁中（附日文詞頭＋讀音當語境；intro_rank 順序，常用詞先翻）
//   - example.zh   ：例句（從日文原句直翻、英文當參考；Tatoeba 人譯已先由 build-example-zh.mjs 填入）
//
// 冪等 & 可續跑：只選 zh/gloss_zh IS NULL 的列、逐批 UPDATE；中斷重跑會從缺的繼續。
// 用法：
//   ANTHROPIC_API_KEY=sk-... node scripts/etl/translate-zh.mjs --target vocab|example|all [--limit N]
//   --limit N   只翻前 N 筆（煙霧測試用）
//
// 模型：claude-haiku-4-5（MODEL 環境變數可覆蓋）。temperature 0、嚴格 JSON 輸出。

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(SCRIPT_DIR, '..', '..');
const CONTENT_DB_PATH = join(APP_ROOT, 'assets', 'db', 'kioku-content.db');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5';
const BATCH_SIZE = 40;
const CONCURRENCY = 6;
const MAX_RETRIES = 5;
// Haiku 4.5 定價（USD / M tokens），僅用於進度顯示的成本估算。
const PRICE_IN_PER_M = 1;
const PRICE_OUT_PER_M = 5;

const SYSTEM_PROMPT = `你是專業的日中辭典編輯，目標讀者是台灣的日語學習者。
規則：
- 一律使用台灣慣用的繁體中文（例：影片不用視頻、品質不用質量、軟體不用軟件）。
- vocab（詞義）：辭典風格、精簡；多個義項以「；」分隔，對應原文的分號；不要加句號結尾；不要重複日文詞本身。
- example（例句）：以日文原句為準直接翻譯（英文僅供參考），口語自然、忠實原意。
- 只輸出 JSON 陣列，格式：[{"id": <數字>, "zh": "<翻譯>"}, ...]，不要任何其他文字。`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    target: get('--target') ?? 'all',
    limit: get('--limit') ? Number(get('--limit')) : Infinity,
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
        temperature: 0,
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

const translateVocabBatch = async (rows) => {
  const items = rows.map((row) => ({
    id: row.id,
    word: row.expression,
    reading: row.reading,
    gloss_en: row.gloss,
  }));
  const prompt = `把下列日文單字的英文釋義翻成台灣繁體中文辭典釋義（word/reading 是該單字與讀音，供判斷語境；只翻 gloss_en）：\n${JSON.stringify(items, null, 0)}`;
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
        const byId = new Map(results.map((r) => [Number(r.id), String(r.zh ?? '').trim()]));
        db.exec('BEGIN');
        for (const row of batch) {
          const zh = byId.get(Number(row.id));
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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 請設定 ANTHROPIC_API_KEY 環境變數');
    process.exit(1);
  }
  if (!existsSync(CONTENT_DB_PATH)) {
    console.error(`❌ 找不到內容庫：${CONTENT_DB_PATH}`);
    process.exit(1);
  }
  const { target, limit } = parseArgs();
  const db = new DatabaseSync(CONTENT_DB_PATH);
  ensureColumn(db, 'vocab', 'gloss_zh');
  ensureColumn(db, 'example', 'zh');

  const limitSql = Number.isFinite(limit) ? ` LIMIT ${limit}` : '';

  if (target === 'vocab' || target === 'all') {
    // 常用詞先翻（intro_rank 升冪），中斷時已翻的都是最有價值的部分。
    const rows = db
      .prepare(`SELECT id, expression, reading, gloss FROM vocab WHERE gloss_zh IS NULL ORDER BY intro_rank IS NULL, intro_rank${limitSql}`)
      .all();
    await runTarget(db, {
      label: 'vocab 詞義',
      rows,
      translateBatch: translateVocabBatch,
      update: db.prepare('UPDATE vocab SET gloss_zh = ? WHERE id = ? AND gloss_zh IS NULL'),
    });
  }

  if (target === 'example' || target === 'all') {
    const rows = db.prepare(`SELECT id, jp, en FROM example WHERE zh IS NULL${limitSql}`).all();
    await runTarget(db, {
      label: 'example 例句',
      rows,
      translateBatch: translateExampleBatch,
      update: db.prepare('UPDATE example SET zh = ? WHERE id = ? AND zh IS NULL'),
    });
  }

  const glossDone = db.prepare("SELECT COUNT(*) AS c FROM vocab WHERE gloss_zh IS NOT NULL AND gloss_zh != ''").get().c;
  const glossTotal = db.prepare('SELECT COUNT(*) AS c FROM vocab').get().c;
  const zhDone = db.prepare("SELECT COUNT(*) AS c FROM example WHERE zh IS NOT NULL AND zh != ''").get().c;
  const zhTotal = db.prepare('SELECT COUNT(*) AS c FROM example').get().c;
  db.close();
  console.log(`\n覆蓋率：gloss_zh ${glossDone}/${glossTotal}、example.zh ${zhDone}/${zhTotal}`);
  console.log(`token 用量：in ${totalIn}、out ${totalOut}`);
};

run();
