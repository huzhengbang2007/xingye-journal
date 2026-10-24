import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWorksheet } from '../public/workbook.js';
test('worksheet selection follows workbook order, resolves names and refuses missing names', () => {
  const files = new Map([
    [
      'xl/workbook.xml',
      '<sheets><sheet name="课表 &amp; 实验" r:id="r2"/><sheet name="账单" r:id="r1"/></sheets>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="/xl/worksheets/sheet10.xml"/></Relationships>',
    ],
    ['xl/worksheets/sheet1.xml', 'bills'],
    ['xl/worksheets/sheet10.xml', 'courses'],
  ]);
  assert.equal(selectWorksheet(files), 'courses');
  assert.equal(selectWorksheet(files, '课表 & 实验'), 'courses');
  assert.equal(selectWorksheet(files, '账单'), 'bills');
  assert.throws(() => selectWorksheet(files, '不存在'), /可选/);
  assert.throws(() => selectWorksheet(files, {}), /名称无效/);
});
