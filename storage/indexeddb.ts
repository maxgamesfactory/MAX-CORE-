import type { JsonValue, StorageContract } from '../contracts/index.js';
import { cloneJson as snapshot } from '../state/json.js';

/** Each write resolves only when its transaction commits. */
export class IndexedDBStorage implements StorageContract {
  private database: Promise<IDBDatabase> | undefined;
  constructor(private readonly name = 'max-core', private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        if (!this.factory) { reject(new Error('IndexedDB unavailable')); return; }
        const request = this.factory.open(this.name, 1);
        let blocked = false;
        request.onupgradeneeded = () => { request.result.createObjectStore('values'); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { blocked = true; reject(new Error('IndexedDB upgrade blocked; close other connections')); };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
      }).catch((error: unknown) => { this.database = undefined; throw error; });
    }
    return this.database;
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('values', mode);
      const request = operation(tx.objectStore('values'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  }
  async get<T extends JsonValue = JsonValue>(key: string): Promise<T | undefined> {
    const result: unknown = await this.transaction('readonly', store => store.get(key));
    return result === undefined ? undefined : snapshot(result as T) as T;
  }
  async set(key: string, value: JsonValue): Promise<void> {
    const data = snapshot(value);
    await this.transaction('readwrite', store => store.put(data, key));
  }
  async remove(key: string): Promise<void> { await this.transaction('readwrite', store => store.delete(key)); }
  async keys(): Promise<string[]> {
    const keys = await this.transaction('readonly', store => store.getAllKeys());
    return keys.map(String).sort();
  }
  async close(): Promise<void> { const db = await this.database; db?.close(); this.database = undefined; }
}
