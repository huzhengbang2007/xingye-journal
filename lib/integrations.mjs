import { assert } from './core.mjs';
const escapeICS = (value) =>
  String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
function fold(line) {
  const chunks = [];
  let chunk = '';
  for (const char of line) {
    if (Buffer.byteLength(chunk + char) > 72) {
      chunks.push(chunk);
      chunk = ' ';
    }
    chunk += char;
  }
  return [...chunks, chunk].join('\r\n');
}
const stamp = (e) => e.replace(/[-:]/g, '') + '00';
export function calendarFeed(events) {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xingyeji//Schedule//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:星野记',
    'X-WR-TIMEZONE:Asia/Shanghai',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Shanghai',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeICS(e.id)}@xingyeji.local`,
      `DTSTAMP:${now}`,
      `SEQUENCE:${e.version || 0}`,
      `DTSTART;TZID=Asia/Shanghai:${stamp(e.date + 'T' + e.start)}`,
      `DTEND;TZID=Asia/Shanghai:${stamp(e.date + 'T' + e.end)}`,
      `SUMMARY:${escapeICS(e.title)}`,
      `LOCATION:${escapeICS(e.location)}`,
      `DESCRIPTION:${escapeICS('来自星野记')}`,
    );
    if (Number.isInteger(e.reminder) && e.reminder >= 0)
      lines.push(
        'BEGIN:VALARM',
        `TRIGGER:-PT${e.reminder}M`,
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeICS(e.title)}`,
        'END:VALARM',
      );
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function diaryEnvelope(envelope) {
  assert(
    envelope &&
      envelope.version === 1 &&
      envelope.kdf === 'PBKDF2-SHA256' &&
      envelope.iterations === 310000,
    '日记加密参数无效',
  );
  for (const [field, exact, max] of [
    ['salt', 16, 24],
    ['iv', 12, 16],
    ['body', 0, 5600000],
  ]) {
    const value = envelope[field];
    assert(
      typeof value === 'string' && value.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(value),
      '日记密文格式无效',
    );
    const decoded = Buffer.from(value, 'base64');
    assert(
      decoded.toString('base64') === value &&
        (exact
          ? decoded.length === exact
          : decoded.length >= 16 && decoded.length <= 4 * 1024 * 1024),
      '日记密文长度无效',
    );
  }
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 310000,
    salt: envelope.salt,
    iv: envelope.iv,
    body: envelope.body,
  };
}
