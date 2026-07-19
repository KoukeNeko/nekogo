#!/usr/bin/env node

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');

const options = { kind: 'vocab', limit: 0, output: '-', order: 'source' };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  const [name, inlineValue] = argument.split('=', 2);
  const value = inlineValue ?? process.argv[++index];
  if (name === '--kind') options.kind = value;
  else if (name === '--limit') options.limit = Number(value);
  else if (name === '--output') options.output = value;
  else if (name === '--order') options.order = value;
  else throw new Error(`未知參數：${argument}`);
}

if (!['vocab', 'example', 'all'].includes(options.kind)) {
  throw new Error('--kind 必須是 vocab、example 或 all');
}
if (!Number.isInteger(options.limit) || options.limit < 0) {
  throw new Error('--limit 必須是大於或等於 0 的整數');
}
if (!['source', 'learning'].includes(options.order)) {
  throw new Error('--order 必須是 source 或 learning');
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const output = options.output === '-' ? process.stdout : createWriteStream(options.output, { encoding: 'utf8' });
const pendingRows = [];

const readRows = (kind, sql) => {
  const statement = db.prepare(sql + (options.limit > 0 ? ' LIMIT ?' : ''));
  const rows = options.limit > 0 ? statement.all(options.limit) : statement.all();
  for (const row of rows) {
    pendingRows.push({
      entry_id: `${kind}:${row.id}`,
      text: row.text,
      priority: options.order === 'learning' ? Number(row.priority) : undefined,
    });
  }
};

if (options.kind === 'vocab' || options.kind === 'all') {
  readRows(
    'vocab',
    `SELECT id, expression AS text,
            COALESCE(freq_rank, intro_rank, 100000000) * 2 AS priority
       FROM vocab
     ORDER BY freq_rank IS NULL, freq_rank, intro_rank, id`,
  );
}
if (options.kind === 'example' || options.kind === 'all') {
  readRows(
    'example',
    `SELECT e.id, e.jp AS text,
            COALESCE(MIN(COALESCE(v.freq_rank, v.intro_rank)), 100000000) * 2 + 1 AS priority
       FROM example e
       LEFT JOIN vocab_example ve ON ve.example_id = e.id
       LEFT JOIN vocab v ON v.id = ve.vocab_id
      GROUP BY e.id, e.jp
      ORDER BY e.id`,
  );
}

if (options.order === 'learning') {
  pendingRows.sort((left, right) => left.priority - right.priority || left.entry_id.localeCompare(right.entry_id));
}
for (const row of pendingRows) {
  output.write(`${JSON.stringify(row)}\n`);
}

db.close();
if (output !== process.stdout) {
  output.end();
  await once(output, 'finish');
}
console.error(`✓ 已輸出 ${pendingRows.length.toLocaleString()} 筆 TTS manifest：${options.output}`);
