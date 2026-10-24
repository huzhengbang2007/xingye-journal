import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormDrafts } from '../public/drafts.js';

function fixture(storage = new Map()) {
  const errors = [];
  const drafts = createFormDrafts({
    storage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    failed: (e) => errors.push(e),
  });
  const listeners = {};
  const form = {
    dataset: {},
    elements: [
      { name: 'title', value: '未保存课程' },
      { name: 'apiKey', type: 'password', value: 'secret-api-key' },
      { name: 'alarm', type: 'checkbox', checked: true },
    ],
    addEventListener: (name, callback) => {
      listeners[name] = callback;
    },
  };
  return { drafts, storage, errors, form, listeners };
}
test('form drafts survive an immediate lock encrypted and recover only with the password', async () => {
  const f = fixture();
  await f.drafts.unlock('draft-password');
  f.drafts.bind(f.form, { kind: 'event', id: 'course-1' });
  f.listeners.input();
  f.drafts.lock();
  await f.drafts.settled();
  assert.equal(f.drafts.list().length, 0);
  const ciphertext = [...f.storage.values()].join();
  assert.ok(!ciphertext.includes('未保存课程'));
  assert.ok(!ciphertext.includes('secret-api-key'));
  const reopened = fixture(f.storage);
  await reopened.drafts.unlock('wrong-password');
  assert.equal(reopened.drafts.list().length, 0);
  assert.equal(reopened.errors.length, 1);
  assert.equal([...f.storage.values()].join(), ciphertext);
  await reopened.drafts.unlock('draft-password');
  assert.deepEqual(reopened.drafts.list()[0].values, { title: '未保存课程', alarm: true });
  reopened.drafts.remove('event:course-1');
  await reopened.drafts.settled();
  await reopened.drafts.unlock('draft-password');
  assert.equal(reopened.drafts.list().length, 0);
});

test('a lock cancels pending draft decryption and large drafts do not overflow the encoder', async () => {
  const f = fixture();
  await f.drafts.unlock('draft-password');
  f.form.elements[0].value = '长内容'.repeat(30000);
  f.drafts.bind(f.form, { kind: 'event' });
  f.listeners.input();
  await f.drafts.settled();
  assert.deepEqual(f.errors, []);
  f.drafts.lock();
  const pending = f.drafts.unlock('draft-password');
  f.drafts.lock();
  await pending;
  assert.equal(f.drafts.list().length, 0);
  await f.drafts.unlock('draft-password');
  assert.equal(f.drafts.list()[0].values.title, f.form.elements[0].value);
});
