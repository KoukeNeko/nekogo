#!/usr/bin/env node

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(SCRIPT_DIR, '..', '..', 'assets', 'db', 'kioku-content.db');

const options = { kind: 'vocab', limit: 0, output: '-' };
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  const [name, inlineValue] = argument.split('=', 2);
  const value = inlineValue ?? process.argv[++index];
  if (name === '--kind') options.kind = value;
  else if (name === '--limit') options.limit = Number(value);
  else if (name === '--output') options.output = value;
  else throw new Error(`未知參數：${argument}`);
}

if (!['vocab', 'example', 'all'].includes(options.kind)) {
  throw new Error('--kind 必須是 vocab、example 或 all');
}
if (!Number.isInteger(options.limit) || options.limit < 0) {
  throw new Error('--limit 必須是大於或等於 0 的整數');
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const output = options.output === '-' ? process.stdout : createWriteStream(options.output, { encoding: 'utf8' });
let count = 0;

const writeRows = (kind, sql) => {
  const statement = db.prepare(sql + (options.limit > 0 ? ' LIMIT ?' : ''));
  const rows = options.limit > 0 ? statement.all(options.limit) : statement.all();
  for (const row of rows) {
    output.write(`${JSON.stringify({ entry_id: `${kind}:${row.id}`, text: row.text })}\n`);
    count += 1;
  }
};

if (options.kind === 'vocab' || options.kind === 'all') {
  writeRows(
    'vocab',
    `SELECT id, expression AS text FROM vocab
     ORDER BY freq_rank IS NULL, freq_rank, intro_rank, id`,
  );
}
if (options.kind === 'example' || options.kind === 'all') {
  writeRows('example', 'SELECT id, jp AS text FROM example ORDER BY id');
}

db.close();
if (output !== process.stdout) {
  output.end();
  await once(output, 'finish');
}
console.error(`✓ 已輸出 ${count.toLocaleString()} 筆 TTS manifest：${options.output}`);
