import test from 'node:test';
import a from 'node:assert/strict';
import { calendarFeed, diaryEnvelope } from '../lib/integrations.mjs';
import { diaryKey, encryptDiary, decryptDiary } from '../public/diary.js';
import { event } from '../lib/core.mjs';
import { icsImport } from '../lib/imports.mjs';

test('calendar export preserves stable IDs, Beijing times, reminders and escapes multiline titles', () => {
  const e = event({
    title: '星野,复习;计划\n第二行',
    date: '2026-10-25',
    start: '10:00',
    end: '11:00',
    reminder: 15,
  });
  const ics = calendarFeed([e]);
  a.ok(ics.includes(`UID:${e.id}@xingyeji.local`));
  a.ok(ics.includes('TRIGGER:-PT15M'));
  a.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20261025T100000'));
  a.ok(ics.includes('星野\\,复习\\;计划\\n第二行'));
  a.equal(icsImport(ics)[0].start, '10:00');
  a.equal(calendarFeed([{ ...e, reminder: -1 }]).includes('BEGIN:VALARM'), false);
  for (const line of calendarFeed([{ ...e, title: '星野记'.repeat(38) }]).split('\r\n'))
    a.ok(Buffer.byteLength(line) <= 72);
});
test('diary second encryption hides metadata and content, authenticates corruption, uses independent nonextractable key', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    key = await diaryKey('independent-diary-password', salt);
  a.equal(key.extractable, false);
  const entries = [
    {
      id: 'entry-1',
      title: '私密标题',
      date: '2026-10-22',
      body: '只有我知道的心事',
      mood: '平静',
    },
  ];
  const envelope = await encryptDiary(entries, key, salt);
  a.equal(JSON.stringify(envelope).includes('私密'), false);
  a.deepEqual(diaryEnvelope(envelope), envelope);
  a.deepEqual(await decryptDiary(envelope, key), entries);
  const same = await diaryKey('independent-diary-password', salt);
  a.deepEqual(await decryptDiary(envelope, same), entries);
  const wrong = await diaryKey('another-diary-password', salt);
  await a.rejects(() => decryptDiary(envelope, wrong));
  const corrupt = { ...envelope, body: 'AAAA' + envelope.body.slice(4) };
  await a.rejects(() => decryptDiary(corrupt, key));
  a.throws(() => diaryEnvelope({ ...envelope, iterations: 1000 }));
  a.throws(() => diaryEnvelope({ ...envelope, salt: 'AA==' }));
  await a.rejects(() => diaryKey('short', salt));
});
