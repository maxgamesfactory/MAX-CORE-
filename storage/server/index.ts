import { Serial } from '../../contracts/value.js';
import { parseRecords, type SyncRecord, type SyncTransport } from '../sync.js';

/** Structural subset implemented by Cloudflare D1 bindings; no vendor runtime import. */
export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
}
export interface D1Database {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<{ success: boolean }[]>;
}
export const D1_SCHEMA = `CREATE TABLE IF NOT EXISTS max_core_records (
  scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  deleted INTEGER NOT NULL, timestamp INTEGER NOT NULL, id TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);`;
/** D1 is the durable authority. Batch is transactional; SQL resolves concurrent writes. */
export interface D1SyncOptions {
  /** Trusted server clock; injectable for deterministic tests. */
  now?: () => number;
  /** Maximum accepted future clock skew, default five minutes. */
  maxFutureSkewMs?: number;
}
export class D1SyncStore implements SyncTransport {
  private readonly now: () => number;
  private readonly maxFutureSkewMs: number;
  constructor(private readonly database: D1Database, private readonly scope: string, options: D1SyncOptions = {}) {
    if (!scope) throw new Error('A trusted tenant scope is required');
    this.now = options.now ?? Date.now;
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? 300_000;
    if (!Number.isSafeInteger(this.maxFutureSkewMs) || this.maxFutureSkewMs < 0) throw new RangeError('Invalid future clock skew limit');
  }
  async exchange(input: readonly SyncRecord[]): Promise<readonly SyncRecord[]> {
    const records = parseRecords(input);
    const latest = this.now() + this.maxFutureSkewMs;
    if (!Number.isSafeInteger(latest) || latest < 0 || latest >= Number.MAX_SAFE_INTEGER) throw new RangeError('Invalid server clock');
    // Validate the entire batch before writing: a peer must not poison tenant clocks.
    if (records.some(record => record.timestamp > latest)) throw new RangeError('Sync timestamp exceeds allowed future clock skew');
    if (records.length) {
      const results = await this.database.batch(records.map(record => this.database.prepare(`
        INSERT INTO max_core_records (scope, key, value, deleted, timestamp, id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, key) DO UPDATE SET value=excluded.value, deleted=excluded.deleted,
          timestamp=excluded.timestamp, id=excluded.id
        WHERE excluded.timestamp > max_core_records.timestamp OR
          (excluded.timestamp = max_core_records.timestamp AND excluded.id > max_core_records.id COLLATE BINARY)
      `).bind(this.scope, record.key, JSON.stringify(record.value), Number(record.deleted), record.timestamp, record.id)));
      if (results.length !== records.length || results.some(result => !result.success)) throw new Error('D1 batch failed');
    }
    const result = await this.database.prepare('SELECT key, value, deleted, timestamp, id FROM max_core_records WHERE scope = ?').bind(this.scope)
      .all<{ key: string; value: string; deleted: number; timestamp: number; id: string }>();
    if (!result.success) throw new Error('D1 snapshot failed');
    return parseRecords(result.results.map(record => ({ ...record, value: JSON.parse(record.value) as unknown, deleted: record.deleted === 1 })));
  }
}

/** Compose inside a Durable Object: one object per authenticated tenant scope.
 * D1 commits before acknowledgement; a DO restart cannot lose acknowledged data.
 * Authentication MUST happen in the outer Worker before routing to this endpoint.
 */
export class DurableObjectSyncEndpoint {
  private readonly serial = new Serial();
  constructor(private readonly store: SyncTransport, private readonly maxBytes = 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError('Invalid request size limit');
  }
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    // Count bytes while streaming; never buffer an unbounded body.
    const reader = request.body?.getReader();
    if (!reader) return new Response('Missing body', { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxBytes) { await reader.cancel(); return new Response('Payload too large', { status: 413 }); }
        chunks.push(value);
      }
    } catch { return new Response('Invalid body', { status: 400 }); }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let records: SyncRecord[];
    try {
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || typeof body !== 'object' || !('records' in body)) throw new Error('Missing records');
      records = parseRecords(body.records);
    } catch { return new Response('Invalid records', { status: 400 }); }
    try {
      return await this.serial.run(async () => Response.json(await this.store.exchange(records)));
    } catch { return new Response('Sync temporarily unavailable', { status: 503 }); }
  }
}
