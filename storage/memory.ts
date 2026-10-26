import type { JsonValue, StorageAdapter } from '../contracts/index.js';
import { snapshot } from '../contracts/value.js';
/** Explicitly volatile storage for tests and hosts without durable storage. */
export class MemoryStorage implements StorageAdapter {
  readonly persistent = false;
  private readonly values = new Map<string, JsonValue>();
  async get(key: string): Promise<JsonValue | undefined> { return this.values.get(key); }
  async set(key: string, value: JsonValue): Promise<void> { this.values.set(key, snapshot(value) as JsonValue); }
  async remove(key: string): Promise<void> { this.values.delete(key); }
}
