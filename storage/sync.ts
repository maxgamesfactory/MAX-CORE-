import type { JsonValue, StorageContract } from '../contracts/index.js';
import { Serial, snapshot } from '../contracts/value.js';

/** Whole-key last-writer-wins record; tombstones prevent deleted values returning. */
export interface SyncRecord {
  key: string;
  value: JsonValue;
  deleted: boolean;
  timestamp: number;
  id: string;
}
export interface SyncTransport { exchange(records: readonly SyncRecord[]): Promise<readonly SyncRecord[]> }
export function parseRecords(value: unknown): SyncRecord[] {
  if (!Array.isArray(value)) throw new TypeError('Expected sync record array');
  return value.map((record: unknown) => {
    if (typeof record !== 'object' || record === null) throw new TypeError('Invalid sync record');
    const item = record as Record<string, unknown>;
    if (typeof item.key !== 'string' || !item.key || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id)
      || typeof item.deleted !== 'boolean' || !Number.isSafeInteger(item.timestamp) || (item.timestamp as number) < 0) {
      throw new TypeError('Invalid sync record metadata');
    }
    return { key: item.key, id: item.id, deleted: item.deleted, timestamp: item.timestamp as number, value: snapshot(item.value as JsonValue) as JsonValue };
  });
}
export function compareRecords(a: SyncRecord, b: SyncRecord): number {
  return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function mergeRecords(...groups: (readonly SyncRecord[])[]): SyncRecord[] {
  const values = new Map<string, SyncRecord>();
  for (const record of groups.flat()) {
    const current = values.get(record.key);
    if (!current || compareRecords(record, current) > 0) values.set(record.key, record);
  }
  return [...values.values()];
}
interface Document { version: 1; records: SyncRecord[]; queue: SyncRecord[]; clock: number }
export interface OfflineStorageOptions {
  /** Each namespace requires one writer instance (coordinate tabs in the host). */
  key?: string;
  now?: () => number;
  /** Must return globally unique, ASCII IDs, e.g. crypto.randomUUID. */
  id?: () => string;
}
/** A snapshot and its outbox are committed in one atomic local write. */
export class OfflineStorage implements StorageContract {
  private readonly serial = new Serial();
  private readonly documentKey: string;
  private readonly now: () => number;
  private readonly id: () => string;
  constructor(private readonly local: StorageContract, private readonly transport: SyncTransport, options: OfflineStorageOptions = {}) {
    this.documentKey = options.key ?? 'max-core:sync:v1';
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => globalThis.crypto.randomUUID());
  }
  private async load(): Promise<Document> {
    const value = await this.local.get(this.documentKey);
    if (value === undefined) return { version: 1, records: [], queue: [], clock: 0 };
    if (value === null || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
      || !Number.isSafeInteger(value.clock) || (value.clock as number) < 0) throw new TypeError('Invalid offline storage document');
    const records = parseRecords(value.records);
    const queue = parseRecords(value.queue);
    return { version: 1, records, queue, clock: [...records, ...queue].reduce((clock, record) => Math.max(clock, record.timestamp), value.clock as number) };
  }
  private save(document: Document): Promise<void> { return this.local.set(this.documentKey, document as unknown as JsonValue); }
  get(key: string): Promise<JsonValue | undefined> {
    return this.serial.run(async () => {
      const record = (await this.load()).records.find(record => record.key === key);
      return record && !record.deleted ? snapshot(record.value) as JsonValue : undefined;
    });
  }
  set(key: string, value: JsonValue): Promise<void> { return this.write(key, snapshot(value) as JsonValue, false); }
  remove(key: string): Promise<void> { return this.write(key, null, true); }
  private write(key: string, value: JsonValue, deleted: boolean): Promise<void> {
    return this.serial.run(async () => {
      const document = await this.load();
      const timestamp = Math.max(this.now(), document.clock + 1);
      const record = parseRecords([{ key, value, deleted, timestamp, id: this.id() }])[0]!;
      document.clock = timestamp;
      document.records = mergeRecords(document.records, [record]);
      document.queue.push(record);
      await this.save(document);
    });
  }
  pending(): Promise<number> { return this.serial.run(async () => (await this.load()).queue.length); }
  /** Failure preserves the outbox. Retrying an acknowledged batch is idempotent. */
  sync(): Promise<void> {
    return this.serial.run(async () => {
      const document = await this.load();
      const remote = parseRecords(await this.transport.exchange(parseRecords(document.queue)));
      // A successful response must account for every sent operation or a newer winner.
      for (const queued of document.queue) {
        const winner = remote.find(record => record.key === queued.key);
        if (!winner || compareRecords(winner, queued) < 0) throw new Error('Server did not acknowledge the complete batch');
      }
      document.records = mergeRecords(document.records, remote);
      document.queue = [];
      document.clock = remote.reduce((clock, record) => Math.max(clock, record.timestamp), document.clock);
      await this.save(document);
    });
  }
  /** Rehydrates a missing local snapshot from the authoritative remote snapshot. */
  recover(): Promise<void> { return this.sync(); }
}

/** Point at an authenticated host endpoint; auth/tenant selection belongs to the host. */
export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly endpoint: string, private readonly request: typeof fetch = globalThis.fetch, private readonly timeoutMs = 15000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid sync timeout');
  }
  async exchange(records: readonly SyncRecord[]): Promise<readonly SyncRecord[]> {
    // Native fetch implementations may reject a transport instance as receiver.
    const request = this.request;
    const response = await request(this.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ records }), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Sync failed (${response.status})`);
    return parseRecords(await response.json());
  }
}
