import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBStorage, MemoryStorage, OfflineStorage, HttpSyncTransport, mergeRecords, parseRecords } from '../dist/index.js';
import { D1SyncStore, D1_SCHEMA, DurableObjectSyncEndpoint } from '../dist/storage/server/index.js';

function sqliteBinding() {
  const database = new DatabaseSync(':memory:');
  database.exec(D1_SCHEMA);
  return {
    database,
    prepare(sql) {
      let values = [];
      const statement = database.prepare(sql);
      return { bind(...next) { values = next; return this; }, async all() { return { success: true, results: statement.all(...values) }; }, run() { statement.run(...values); } };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try { for (const statement of statements) statement.run(); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
      return statements.map(() => ({ success: true }));
    },
  };
}
function memoryServer() {
  let values = [];
  return { async exchange(records) { values = mergeRecords(values, parseRecords(records)); return values; } };
}
function options(prefix) {
  let sequence = 0;
  return { now: () => 100, id: () => `${prefix}-${++sequence}` };
}

test('IndexedDB survives close/reopen and resolves committed writes', async () => {
  const factory = new IDBFactory();
  const storage = new IndexedDBStorage(factory, 'durable');
  const original = { value: [1, 2] };
  await storage.set('key', original); original.value.push(3);
  await storage.close();
  const restored = new IndexedDBStorage(factory, 'durable');
  assert.deepEqual(await restored.get('key'), { value: [1, 2] });
  const value = await restored.get('key');
  assert.throws(() => value.value.push(4), TypeError);
  await restored.remove('key'); assert.equal(await restored.get('key'), undefined);
  await restored.recover(); await restored.set('other', true);
  await restored.close();
});

test('IndexedDB transaction abort rejects even after request succeeds', async () => {
  const factory = new IDBFactory();
  const storage = new IndexedDBStorage(factory, 'abort');
  await storage.set('key', 'before');
  // Abort an actual fake-indexeddb transaction after put success, before commit.
  const connection = await new Promise((resolve, reject) => {
    const request = factory.open('abort', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const proto = Object.getPrototypeOf(connection.transaction('records', 'readwrite').objectStore('records'));
  const original = proto.put;
  proto.put = function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(storage.set('key', 'after'), /aborted/); }
  finally { proto.put = original; }
  assert.equal(await storage.get('key'), 'before');
  connection.close(); await storage.close();
});

test('offline queue survives restart, retries response loss and converges with tombstones', async () => {
  const authority = memoryServer();
  let disconnected = true, loseResponse = false;
  const transport = { async exchange(records) {
    if (disconnected) throw new Error('offline');
    const result = await authority.exchange(records);
    if (loseResponse) { loseResponse = false; throw new Error('response lost'); }
    return result;
  } };
  const local = new MemoryStorage();
  let a = new OfflineStorage(local, transport, options('a'));
  await a.set('state', { count: 1 });
  await assert.rejects(a.sync(), /offline/);
  a = new OfflineStorage(local, transport, options('a-restart'));
  assert.equal(await a.pending(), 1); assert.deepEqual(await a.get('state'), { count: 1 });
  disconnected = false; loseResponse = true;
  await assert.rejects(a.sync(), /response lost/); assert.equal(await a.pending(), 1);
  await a.sync(); assert.equal(await a.pending(), 0);
  const b = new OfflineStorage(new MemoryStorage(), authority, options('b'));
  await b.sync(); assert.deepEqual(await b.get('state'), { count: 1 });
  await a.set('state', { count: 2 }); await b.set('state', { count: 3 });
  await b.sync(); await a.sync(); await b.sync();
  assert.deepEqual(await a.get('state'), await b.get('state'));
  assert.deepEqual(await a.get('state'), { count: 3 }); // Same logical time: ASCII id wins.
  await a.remove('state'); await a.sync(); await b.sync();
  assert.equal(await b.get('state'), undefined);
  assert.equal((await authority.exchange([]))[0].deleted, true);
});

test('Safari-style database loss recovers acknowledged data from remote', async () => {
  const factory = new IDBFactory();
  const local = new IndexedDBStorage(factory, 'loss');
  const remote = memoryServer();
  const storage = new OfflineStorage(local, remote, options('client'));
  await storage.set('saved', { score: 5 }); await storage.sync();
  await storage.set('unsynced', 'only on device');
  await local.close();
  await new Promise((resolve, reject) => {
    const request = factory.deleteDatabase('loss'); request.onsuccess = resolve; request.onerror = () => reject(request.error);
  });
  await local.recover(); await storage.recover();
  assert.deepEqual(await storage.get('saved'), { score: 5 });
  assert.equal(await storage.get('unsynced'), undefined);
  await local.close();
});

test('failed local commit after remote ack retains outbox for safe retry', async () => {
  const memory = new MemoryStorage();
  let fail = false;
  const local = { get: key => memory.get(key), remove: key => memory.remove(key), async set(key, value) { if (fail) throw new Error('quota'); await memory.set(key, value); } };
  const remote = memoryServer();
  const storage = new OfflineStorage(local, remote, options('a'));
  await storage.set('x', 1); fail = true;
  await assert.rejects(storage.sync(), /quota/); assert.equal(await storage.pending(), 1);
  fail = false; await storage.sync(); assert.equal(await storage.pending(), 0);
  assert.equal((await remote.exchange([])).length, 1);
});

test('malformed or incomplete responses cannot discard queue; concurrent local edits serialize', async () => {
  const local = new MemoryStorage();
  const storage = new OfflineStorage(local, { exchange: async () => [] }, options('x'));
  await Promise.all([storage.set('one', 1), storage.set('two', 2)]);
  await assert.rejects(storage.sync(), /acknowledge/);
  assert.equal(await storage.pending(), 2);
  assert.equal(await storage.get('one'), 1); assert.equal(await storage.get('two'), 2);
  assert.throws(() => parseRecords([{ key: 'x', value: 1, deleted: false, timestamp: NaN, id: 'a' }]), TypeError);
  await local.set('max-core:sync:v1', { version: 2 });
  await assert.rejects(storage.recover(), /Invalid offline/);
});

test('D1 SQL upserts, tenant isolation, tombstones and durable endpoint reconstruction', async () => {
  const binding = sqliteBinding();
  try {
    const store = new D1SyncStore(binding, 'tenant-a');
    const record = { key: 'k', value: 1, timestamp: 1, id: 'a', deleted: false };
    await store.exchange([record]);
    await store.exchange([{ ...record, value: 2, id: 'z' }]);
    await store.exchange([record]);
    assert.equal((await store.exchange([]))[0].value, 2);
    await store.exchange([{ ...record, value: null, timestamp: 2, deleted: true }]);
    assert.equal((await new D1SyncStore(binding, 'tenant-a').exchange([]))[0].deleted, true);
    assert.deepEqual(await new D1SyncStore(binding, 'tenant-b').exchange([]), []);
    let endpoint = new DurableObjectSyncEndpoint(store);
    const request = async (_url, init) => endpoint.fetch(new Request('https://sync.test', init));
    const transport = new HttpSyncTransport('https://sync.test', request);
    await transport.exchange([{ ...record, key: 'new' }]);
    endpoint = new DurableObjectSyncEndpoint(new D1SyncStore(binding, 'tenant-a'));
    assert.equal((await transport.exchange([])).length, 2);
    assert.equal((await endpoint.fetch(new Request('https://sync.test'))).status, 405);
    assert.equal((await endpoint.fetch(new Request('https://sync.test', { method: 'POST', body: '{}' }))).status, 400);
    const tiny = new DurableObjectSyncEndpoint(store, 5);
    assert.equal((await tiny.fetch(new Request('https://sync.test', { method: 'POST', body: '{"records":[]}' }))).status, 413);
  } finally { binding.database.close(); }
});

test('endpoint and HTTP transport expose retryable backend failures', async () => {
  const endpoint = new DurableObjectSyncEndpoint({ exchange: async () => { throw new Error('db unavailable'); } });
  const response = await endpoint.fetch(new Request('https://sync.test', { method: 'POST', body: '{"records":[]}' }));
  assert.equal(response.status, 503);
  const transport = new HttpSyncTransport('https://sync.test', async () => response);
  await assert.rejects(transport.exchange([]), /503/);
});


test('HTTP transport invokes native-style fetch without a transport receiver', async () => {
  const transport = new HttpSyncTransport('https://sync.test', async function (_url, init) {
    assert.equal(this, undefined);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { records: [] });
    return Response.json([]);
  });
  assert.deepEqual(await transport.exchange([]), []);
});


test('D1 rejects a poisoned future clock before writing any part of the batch', async () => {
  const binding = sqliteBinding();
  try {
    const store = new D1SyncStore(binding, 'tenant', { now: () => 1000, maxFutureSkewMs: 10 });
    const normal = { key: 'normal', value: 1, deleted: false, timestamp: 1000, id: 'a' };
    for (const timestamp of [1011, 8_640_000_000_000_000, Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(store.exchange([normal, { ...normal, key: 'poison', timestamp, id: 'b' }]), /future clock skew/);
      assert.deepEqual(await store.exchange([]), []);
    }
    await store.exchange([{ ...normal, timestamp: 1010 }]);
    const client = new OfflineStorage(new MemoryStorage(), store, { now: () => 1000, id: () => 'c' });
    await client.sync();
    await client.set('still-writable', true);
    assert.equal(await client.get('still-writable'), true);
  } finally { binding.database.close(); }
});
