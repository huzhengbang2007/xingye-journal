import test from 'node:test';
import assert from 'node:assert/strict';
import { placeQuery, mapSearch } from '../public/places.js';
test('map search preserves classroom text and encodes user punctuation as a query value', () => {
  const raw = '大连理工大学  凌水校区 A１０１ & 图书馆';
  const url = new URL(mapSearch(raw));
  assert.equal(url.origin, 'https://uri.amap.com');
  assert.equal(url.searchParams.get('keyword'), '大连理工大学 凌水校区 A101 & 图书馆');
  assert.equal(url.searchParams.get('callnative'), '1');
  assert.equal(placeQuery('A101'), 'A101');
});
test('invalid place input is rejected instead of pretending a share link is a geographic address', () => {
  for (const input of ['', ' '.repeat(5), 'https://evil.example/path', 'geo:0,0', 'x'.repeat(121)])
    assert.throws(() => mapSearch(input));
});
