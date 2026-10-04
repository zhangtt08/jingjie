import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/main/storage.js';

test('failed JSON serialization or disk sync preserves the store and removes temporary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jingjie-storage-'));
  try {
    const store = new AtomicJsonStore(join(dir, 'state.json'), {});
    await store.write({ value: 'old' });
    const cyclic = {};
    cyclic.self = cyclic;
    await assert.rejects(store.write(cyclic), /circular/i);
    const probe = await open(join(dir, 'probe'), 'w');
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const injected = mock.method(prototype, 'sync', async () => { throw new Error('disk full'); });
    try { await assert.rejects(store.write({ value: 'lost' }), /disk full/); }
    finally { injected.mock.restore(); }
    assert.deepEqual(await store.read(), { value: 'old' });
    assert.equal((await readdir(dir)).some(name => name.endsWith('.tmp')), false);
    await store.write({ value: 'new' });
    assert.deepEqual(await store.read(), { value: 'new' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
