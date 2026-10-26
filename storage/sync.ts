import type { JsonValue, StorageContract, SyncDelta, SynchronizationContract, SyncTransport, SyncVersion } from '../contracts/index.js';
import { cloneJson as snapshot } from '../state/json.js';

type Document = { format: 1; clock: number; entries: SyncDelta[]; pending: SyncDelta[] };
const empty = (): Document => ({ format: 1, clock: 0, entries: [], pending: [] });

/** Lamport counter, then stable UTF-16 node ordering. No wall clocks. */
export function compareVersions(a: SyncVersion, b: SyncVersion): number {
  return a.counter === b.counter ? (a.node < b.node ? -1 : a.node > b.node ? 1 : 0) : (a.counter < b.counter ? -1 : 1);
}

function validateDelta(value: unknown): SyncDelta {
  const delta = value as Partial<SyncDelta> | null;
  if (!delta || typeof delta.key !== 'string' || typeof delta.deleted !== 'boolean' || !delta.version || !Number.isSafeInteger(delta.version.counter) || delta.version.counter < 1 || typeof delta.version.node !== 'string' || !delta.version.node) throw new Error('Invalid sync delta');
  snapshot(delta.value as JsonValue);
  return snapshot(delta as SyncDelta & JsonValue) as unknown as SyncDelta;
}
function loadDocument(value: JsonValue | undefined): Document {
  if (value === undefined) return empty();
  const doc = value as unknown as Document;
  if (!doc || doc.format !== 1 || !Number.isSafeInteger(doc.clock) || doc.clock < 0 || !Array.isArray(doc.entries) || !Array.isArray(doc.pending)) throw new Error('Invalid sync document; restore a valid backup');
  const entries = doc.entries.map(validateDelta);
  const pending = doc.pending.map(validateDelta);
  const byKey = new Map(entries.map(delta => [delta.key, delta]));
  if (byKey.size !== entries.length || new Set(pending.map(delta => delta.key)).size !== pending.length || entries.some(delta => delta.version.counter > doc.clock) || pending.some(delta => JSON.stringify(delta) !== JSON.stringify(byKey.get(delta.key)))) throw new Error('Inconsistent sync document');
  return { format: 1, clock: doc.clock, entries, pending };
}
function merge(entries: readonly SyncDelta[], incoming: readonly SyncDelta[]): SyncDelta[] {
  const records = new Map(entries.map(delta => [delta.key, delta]));
  for (const delta of incoming) {
    const current = records.get(delta.key);
    if (!current || compareVersions(delta.version, current.version) > 0) records.set(delta.key, delta);
  }
  return [...records.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** One writer per (storage, documentKey); persist records and queue in one atomic write. */
export class SyncReplica implements SynchronizationContract {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly local: StorageContract, private readonly transport: SyncTransport, private readonly node: string, private readonly documentKey = 'max-core:sync') {
    if (!node) throw new Error('A unique, persistent node ID is required');
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<Document> { return loadDocument(await this.local.get(this.documentKey)); }
  private async save(doc: Document): Promise<void> { await this.local.set(this.documentKey, doc as unknown as JsonValue); }
  rehydrate(): Promise<void> { return this.exclusive(async () => { await this.read(); }); }
  get(key: string): Promise<JsonValue | undefined> {
    return this.exclusive(async () => {
      const delta = (await this.read()).entries.find(entry => entry.key === key);
      return !delta || delta.deleted ? undefined : snapshot(delta.value) as unknown as JsonValue;
    });
  }
  async set(key: string, value: JsonValue): Promise<void> {
    const data = snapshot(value) as unknown as JsonValue;
    return this.write(key, data, false);
  }
  remove(key: string): Promise<void> { return this.write(key, null, true); }
  private write(key: string, value: JsonValue, deleted: boolean): Promise<void> {
    return this.exclusive(async () => {
      const doc = await this.read();
      if (doc.clock === Number.MAX_SAFE_INTEGER) throw new Error('Sync clock exhausted');
      const delta: SyncDelta = { key, value, deleted, version: { counter: doc.clock + 1, node: this.node } };
      await this.save({ format: 1, clock: delta.version.counter, entries: merge(doc.entries, [delta]), pending: merge(doc.pending, [delta]) });
    });
  }
  pending(): Promise<number> { return this.exclusive(async () => (await this.read()).pending.length); }
  flush(): Promise<void> {
    return this.exclusive(async () => {
      const doc = await this.read();
      const incoming = (await this.transport.exchange(snapshot(doc.pending as unknown as JsonValue) as unknown as readonly SyncDelta[])).map(validateDelta);
      const clock = incoming.reduce((value, delta) => Math.max(value, delta.version.counter), doc.clock);
      await this.save({ format: 1, clock, entries: merge(doc.entries, incoming), pending: [] });
    });
  }
}

/** Deploy behind an authenticated transport, with one serial authority per document. */
export class SyncAuthority implements SyncTransport {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: StorageContract, private readonly documentKey = 'max-core:authority') {}
  async exchange(deltas: readonly SyncDelta[]): Promise<SyncDelta[]> {
    // Copy before waiting on another exchange; transport callers retain no references.
    const incoming = deltas.map(validateDelta);
    const result = this.tail.then(async () => {
      const doc = loadDocument(await this.storage.get(this.documentKey));
      const entries = merge(doc.entries, incoming);
      const clock = entries.reduce((value, delta) => Math.max(value, delta.version.counter), doc.clock);
      await this.storage.set(this.documentKey, { format: 1, clock, entries, pending: [] } as unknown as JsonValue);
      return snapshot(entries as unknown as JsonValue) as unknown as SyncDelta[];
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
