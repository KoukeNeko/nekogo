import { open } from '@op-engineering/op-sqlite';
const db = open({ name: 'kioku.sqlite' });
const res = db.executeSync('SELECT 1 as count');
console.log(JSON.stringify(res));
