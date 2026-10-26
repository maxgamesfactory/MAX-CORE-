import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DatabaseSync } from 'node:sqlite';
import { D1Storage, DurableObjectStorage, IndexedDBStorage, MemoryStorage, SyncAuthority, SyncReplica, compareVersions } from '../index.js';
import type { D1Binding, D1Statement, DurableObjectStorageBinding, JsonValue, StorageContract, SyncDelta, SyncTransport } from '../index.js';

function sqliteBinding(): { binding: D1Binding; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const binding: D1Binding = { prepare(sql) {
    let args: unknown[] = [];
    const statement: D1Statement = {
      bind(...values) { args = values; return statement; },
      async run() { db.prepare(sql).run(...args as (string | number)[]); return { success: true }; },
      async first<T>() { return (db.prepare(sql).get(...args as (string | number)[]) ?? null) as T | null; },
      async all<T>() { return { success: true, results: db.prepare(sql).all(...args as (string | number)[]) as T[] }; }
    }; return statement;
  } }; return { binding, db };
}
function durableBinding(): DurableObjectStorageBinding {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async put(key, value) { map.set(key, structuredClone(value)); },
    async delete(key) { return map.delete(key); },
    async list<T>() { return new Map(map) as Map<string, T>; }
  };
}
const storageFactories = [
  { name: 'Memory', make: async () => ({ storage: new MemoryStorage(), close: async () => undefined }) },
  { name: 'IndexedDB', make: async () => { const storage = new IndexedDBStorage('contract', new IDBFactory()); return { storage, close: () => storage.close() }; } },
  { name: 'Durable Objects', make: async () => ({ storage: new DurableObjectStorage(durableBinding()), close: async () => undefined }) },
  { name: 'D1 SQL', make: async () => { const { binding, db } = sqliteBinding(); const storage = new D1Storage(binding); await storage.initialize(); return { storage, close: async () => db.close() }; } }
];
describe.each(storageFactories)('$name storage contract', ({ make }) => {
  it('reads, copies, overwrites, lists, deletes and preserves JSON values', async () => {
    const { storage, close } = await make();
    try {
      expect(await storage.get('absent')).toBeUndefined(); expect(await storage.keys()).toEqual([]);
      const input = { nested: [1, 2] }; await storage.set('z', input); input.nested.push(3);
      expect(await storage.get('z')).toEqual({ nested: [1, 2] });
      await storage.set('a', null); await storage.set("'; DROP TABLE max_core_kv; --", true);
      expect(await storage.get('a')).toBeNull(); expect(await storage.keys()).toEqual(["'; DROP TABLE max_core_kv; --", 'a', 'z']);
      await storage.set('\u{10000}', 'supplementary'); await storage.set('\ue000', 'bmp');
      expect((await storage.keys()).slice(-2)).toEqual(['\u{10000}', '\ue000']);
      await storage.set('z', 3); expect(await storage.get('z')).toBe(3);
      await storage.remove('a'); await storage.remove('missing'); expect(await storage.get('a')).toBeUndefined();
      await expect(storage.set('bad', NaN)).rejects.toThrow(TypeError); expect(await storage.get('bad')).toBeUndefined();
    } finally { await close(); }
  });
});
describe('IndexedDB recovery', () => {
  it('rehydrates another instance and reopens after close or a version change', async () => {
    const factory = new IDBFactory(); const first = new IndexedDBStorage('shared', factory); const second = new IndexedDBStorage('shared', factory);
    await first.close(); await first.set('state', { n: 4 }); expect(await second.get('state')).toEqual({ n: 4 });
    await first.close(); expect(await first.get('state')).toEqual({ n: 4 });
    await new Promise<void>((resolve, reject) => { const request = factory.deleteDatabase('shared'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    expect(await first.keys()).toEqual([]); await first.close(); await second.close();
  });
  it('reports unavailable storage and retries failed opens', async () => {
    await expect(new IndexedDBStorage().keys()).rejects.toThrow('unavailable');
    const factory = new IDBFactory(); const original = factory.open.bind(factory); let failed = false;
    vi.spyOn(factory, 'open').mockImplementation((...args) => {
      if (failed) return original(...args);
      failed = true;
      const request = { error: new Error('open failed'), onerror: undefined as undefined | (() => void) };
      queueMicrotask(() => request.onerror?.()); return request as unknown as IDBOpenDBRequest;
    });
    const storage = new IndexedDBStorage('retry', factory); await expect(storage.keys()).rejects.toThrow('open failed');
    await storage.set('x', 1); expect(await storage.get('x')).toBe(1); await storage.close();
  });
  it('rejects blocked upgrades and closes a late successful connection', async () => {
    const close = vi.fn(); const request = { result: { close }, onblocked: undefined as undefined | (() => void), onsuccess: undefined as undefined | (() => void) };
    const factory = { open: () => { queueMicrotask(() => { request.onblocked?.(); request.onsuccess?.(); }); return request; } } as unknown as IDBFactory;
    await expect(new IndexedDBStorage('blocked', factory).keys()).rejects.toThrow('blocked'); expect(close).toHaveBeenCalledOnce();
  });
  it.each(['onabort', 'onerror'] as const)('reports transaction %s with and without a host error', async event => {
    for (const error of [null, new Error('host failure')]) {
      const tx = { error, onabort: undefined as undefined | (() => void), onerror: undefined as undefined | (() => void), objectStore: () => ({ get: () => { queueMicrotask(() => tx[event]?.()); return {}; } }) };
      const request = { result: { transaction: () => tx }, onsuccess: undefined as undefined | (() => void) };
      const factory = { open: () => { queueMicrotask(() => request.onsuccess?.()); return request; } } as unknown as IDBFactory;
      await expect(new IndexedDBStorage('fault', factory).get('x')).rejects.toThrow(error ? 'host failure' : event === 'onabort' ? 'aborted' : 'failed');
    }
  });
});
describe('cloud storage failures', () => {
  it('propagates D1 result failures and corrupt JSON', async () => {
    const storage = new D1Storage({ prepare: () => {
      const statement: D1Statement = { bind: () => statement, run: async () => ({ success: false }), first: async <T>() => ({ value: 'broken' }) as T, all: async () => ({ success: false, results: [] }) }; return statement;
    } });
    await expect(storage.initialize()).rejects.toThrow('write failed'); await expect(storage.keys()).rejects.toThrow('query failed'); await expect(storage.get('x')).rejects.toThrow(SyntaxError);
  });
  it('propagates host binding failures', async () => {
    const binding = durableBinding(); binding.get = async () => { throw new Error('binding'); };
    await expect(new DurableObjectStorage(binding).get('x')).rejects.toThrow('binding');
  });
});
const delta = (key: string, counter: number, node = 'remote', value: JsonValue = counter, deleted = false): SyncDelta => ({ key, value, deleted, version: { counter, node } });
const asJson = (value: unknown) => value as JsonValue;
describe('synchronization', () => {
  it('uses a total, deterministic version ordering', () => {
    expect(compareVersions({ counter: 1, node: 'a' }, { counter: 2, node: 'a' })).toBe(-1);
    expect(compareVersions({ counter: 2, node: 'a' }, { counter: 1, node: 'b' })).toBe(1);
    expect(compareVersions({ counter: 1, node: 'a' }, { counter: 1, node: 'b' })).toBe(-1);
    expect(compareVersions({ counter: 1, node: 'b' }, { counter: 1, node: 'a' })).toBe(1);
    expect(compareVersions({ counter: 1, node: 'a' }, { counter: 1, node: 'a' })).toBe(0);
  });
  it('persists an offline queue, rehydrates, retries and converges conflicts including tombstones', async () => {
    const authority = new SyncAuthority(new MemoryStorage()); const local = new IndexedDBStorage('offline', new IDBFactory()); let online = false;
    const transport: SyncTransport = { exchange: deltas => { if (!online) return Promise.reject(new Error('offline')); return authority.exchange(deltas); } };
    const a = new SyncReplica(local, transport, 'a'); const b = new SyncReplica(new MemoryStorage(), authority, 'b');
    expect(await a.get('missing')).toBeUndefined(); await a.rehydrate();
    await a.set('item', { n: 1 }); await a.set('item', { n: 2 }); expect(await a.pending()).toBe(1);
    await expect(a.flush()).rejects.toThrow('offline'); expect(await a.pending()).toBe(1);
    const restored = new SyncReplica(local, transport, 'a'); await restored.rehydrate(); expect(await restored.get('item')).toEqual({ n: 2 });
    await b.set('item', { n: 3 }); await b.set('item', { n: 4 }); await b.flush(); online = true; await restored.flush();
    expect(await restored.get('item')).toEqual({ n: 4 }); expect(await restored.pending()).toBe(0);
    await restored.remove('item'); await restored.set('__proto__', true); await restored.flush(); await b.flush();
    expect(await b.get('item')).toBeUndefined(); expect(await b.get('__proto__')).toBe(true); expect(await b.pending()).toBe(0);
    await restored.set('new', null); await restored.flush(); await b.flush(); expect(await b.get('new')).toBeNull(); await local.close();
  });
  it('serializes simultaneous writes and in-flight flushes without losing updates', async () => {
    const authority = new SyncAuthority(new MemoryStorage()); const replica = new SyncReplica(new MemoryStorage(), authority, 'a');
    await Promise.all([replica.set('z', 1), replica.set('a', 2), replica.set('a', 3), replica.flush(), replica.set('z', 4), replica.flush()]);
    expect(await replica.get('a')).toBe(3); expect(await replica.get('z')).toBe(4); expect(await replica.pending()).toBe(0);
    const observer = new SyncReplica(new MemoryStorage(), authority, 'b'); await observer.flush(); expect(await observer.get('z')).toBe(4);
  });
  it('preserves queued changes after an acknowledged response fails to persist and resends idempotently', async () => {
    const local = new MemoryStorage(); const authority = new SyncAuthority(new MemoryStorage()); const replica = new SyncReplica(local, authority, 'a');
    await replica.set('x', 1); const write = local.set.bind(local); vi.spyOn(local, 'set').mockRejectedValueOnce(new Error('quota')).mockImplementation(write);
    await expect(replica.flush()).rejects.toThrow('quota'); expect(await replica.pending()).toBe(1); await replica.flush(); expect(await replica.pending()).toBe(0);
    expect(await authority.exchange([])).toHaveLength(1);
  });
  it('does not retain caller references while a write waits, and continues after rejected operations', async () => {
    const local = new MemoryStorage(); const replica = new SyncReplica(local, { exchange: async () => [] }, 'node');
    const value = { n: 1 }; const write = replica.set('x', value); value.n = 2; await write; expect(await replica.get('x')).toEqual({ n: 1 });
    await expect(replica.set('x', NaN)).rejects.toThrow(TypeError);
    await local.set('max-core:sync', { format: 1, clock: Number.MAX_SAFE_INTEGER, entries: [], pending: [] });
    await expect(replica.set('x', 3)).rejects.toThrow('exhausted');
    await local.remove('max-core:sync'); await replica.set('x', 3); expect(await replica.get('x')).toBe(3);
  });
  it('rejects invalid node identities and malformed persisted documents', async () => {
    const local = new MemoryStorage(); const transport = { exchange: async () => [] };
    expect(() => new SyncReplica(local, transport, '')).toThrow('node ID');
    const replica = new SyncReplica(local, transport, 'node');
    for (const invalid of [null, {}, { format: 2, clock: 0, entries: [], pending: [] }, { format: 1, clock: -1, entries: [], pending: [] }, { format: 1, clock: 0, entries: {}, pending: [] }, { format: 1, clock: 0, entries: [], pending: {} }]) {
      await local.set('max-core:sync', asJson(invalid)); await expect(replica.rehydrate()).rejects.toThrow('Invalid sync document');
    }
    for (const invalid of [
      { format: 1, clock: 1, entries: [delta('x', 1), delta('x', 1)], pending: [] },
      { format: 1, clock: 1, entries: [delta('x', 1)], pending: [delta('x', 1), delta('x', 1)] },
      { format: 1, clock: 0, entries: [delta('x', 1)], pending: [] },
      { format: 1, clock: 1, entries: [delta('x', 1)], pending: [delta('y', 1)] }
    ]) { await local.set('max-core:sync', asJson(invalid)); await expect(replica.rehydrate()).rejects.toThrow('Inconsistent'); }
  });
  it('rejects malformed remote deltas without acknowledging local changes', async () => {
    const invalid = [null, {}, { key: 1 }, { ...delta('x', 1), deleted: 'yes' }, { ...delta('x', 1), version: null }, delta('x', 0), delta('x', 1.5), delta('x', 1, ''), { ...delta('x', 1), version: { counter: 1, node: 2 } }, { ...delta('x', 1), value: undefined }];
    for (const value of invalid) {
      const replica = new SyncReplica(new MemoryStorage(), { exchange: async () => [value as SyncDelta] }, 'node');
      await replica.set('x', 1); await expect(replica.flush()).rejects.toThrow(); expect(await replica.pending()).toBe(1);
    }
  });
  it('recovers an authority after persistence errors and honors custom document namespaces', async () => {
    const store = new MemoryStorage(); const authority = new SyncAuthority(store, 'custom');
    const original = store.set.bind(store); vi.spyOn(store, 'set').mockRejectedValueOnce(new Error('disk')).mockImplementation(original);
    await expect(authority.exchange([delta('a', 1)])).rejects.toThrow('disk');
    await Promise.all([authority.exchange([delta('b', 2)]), authority.exchange([delta('a', 1)])]);
    const replica = new SyncReplica(new MemoryStorage(), authority, 'node', 'custom'); await replica.flush(); expect(await replica.get('b')).toBe(2);
    expect((await new SyncAuthority(store, 'custom').exchange([])).map(entry => entry.key)).toEqual(['a', 'b']);
  });
});

it('rejects malformed authority exchanges through its promised error channel', async () => {
  const authority = new SyncAuthority(new MemoryStorage());
  await expect(authority.exchange([{} as SyncDelta])).rejects.toThrow('Invalid sync delta');
});
