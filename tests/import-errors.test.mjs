import test from 'node:test';
import assert from 'node:assert/strict';
import { billImport } from '../lib/imports.mjs';
test('bad dates and amounts identify their parsed rows without aborting the whole bill', () => {
  const result = billImport(
    [
      ['交易时间', '交易对方', '收/支', '金额(元)', '当前状态'],
      ['2026-10-24', '食堂', '支出', '12.50', '支付成功'],
      ['999999999999999999999999', '食堂', '支出', '2', '支付成功'],
      ['2026-10-24', '食堂', '支出', '不是金额', '支付成功'],
    ],
    'wechat',
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.invalid, 2);
  assert.deepEqual(
    result.invalidRows.map((row) => row.row),
    [3, 4],
  );
  assert.match(result.invalidRows[0].reason, /日期/);
  assert.match(result.invalidRows[1].reason, /金额/);
});
