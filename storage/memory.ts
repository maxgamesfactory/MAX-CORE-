import type { JsonValue, StorageContract } from '../contracts/index.js';
import { cloneJson as snapshot } from '../state/json.js';

export class MemoryStorage implements StorageContract {
  private readonly values = new Map<string, JsonValue>();
  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async set(key: string, value: JsonValue): Promise<void> { this.values.set(key, snapshot(value) as unknown as JsonValue); }
  async remove(key: string): Promise<void> { this.values.delete(key); }
  async keys(): Promise<string[]> { return [...this.values.keys()].sort(); }
}
