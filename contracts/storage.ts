import type { JsonValue } from './common.js';
export interface StorageContract {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}
export interface SyncVersion { counter: number; node: string }
export interface SyncDelta { key: string; value: JsonValue; deleted: boolean; version: SyncVersion }
export interface SyncTransport {
  /** The server must apply versions atomically and idempotently, returning remote deltas. */
  exchange(deltas: readonly SyncDelta[]): Promise<SyncDelta[]>;
}
export interface SynchronizationContract {
  rehydrate(): Promise<void>;
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<void>;
  flush(): Promise<void>;
  pending(): Promise<number>;
}
/** Structural Cloudflare bindings: no vendor SDK in the core. */
export interface DurableObjectStorageBinding {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<unknown>;
  delete(key: string): Promise<boolean>;
  list<T>(): Promise<Map<string, T>>;
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ success: boolean }>;
  all<T>(): Promise<{ success: boolean; results: T[] }>;
}
export interface D1Binding { prepare(sql: string): D1Statement }
