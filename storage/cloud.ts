import type { D1Binding, DurableObjectStorageBinding, JsonValue, StorageContract } from '../contracts/index.js';
import { cloneJson as snapshot } from '../state/json.js';

export class DurableObjectStorage implements StorageContract {
  constructor(private readonly binding: DurableObjectStorageBinding) {}
  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    const value = await this.binding.get<T>(key);
    return value === undefined ? undefined : snapshot(value) as T;
  }
  async set(key: string, value: JsonValue): Promise<void> { await this.binding.put(key, snapshot(value)); }
  async remove(key: string): Promise<void> { await this.binding.delete(key); }
  async keys(): Promise<string[]> { return [...(await this.binding.list()).keys()].sort(); }
}

/** Call initialize once at deployment/startup; SQL identifiers are fixed. */
export class D1Storage implements StorageContract {
  constructor(private readonly binding: D1Binding) {}
  async initialize(): Promise<void> {
    await this.execute('CREATE TABLE IF NOT EXISTS max_core_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    const row = await this.binding.prepare('SELECT value FROM max_core_kv WHERE key = ?').bind(key).first<{ value: string }>();
    return row === null ? undefined : snapshot(JSON.parse(row.value) as T) as T;
  }
  async set(key: string, value: JsonValue): Promise<void> {
    await this.execute('INSERT INTO max_core_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(snapshot(value)));
  }
  async remove(key: string): Promise<void> { await this.execute('DELETE FROM max_core_kv WHERE key = ?', key); }
  async keys(): Promise<string[]> {
    const result = await this.binding.prepare('SELECT key FROM max_core_kv ORDER BY key').all<{ key: string }>();
    if (!result.success) throw new Error('D1 query failed');
    return result.results.map(row => row.key).sort();
  }
  private async execute(sql: string, ...values: unknown[]): Promise<void> {
    const result = await this.binding.prepare(sql).bind(...values).run();
    if (!result.success) throw new Error('D1 write failed');
  }
}
