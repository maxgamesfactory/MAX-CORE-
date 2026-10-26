import type { JsonValue, StorageAdapter } from '../contracts/index.js';
import { snapshot } from '../contracts/value.js';

/** Atomic writes resolve on transaction completion, never merely request success. */
export class IndexedDBStorage implements StorageAdapter {
  readonly persistent = true;
  private connection: Promise<IDBDatabase> | undefined;
  constructor(private readonly factory: IDBFactory, private readonly databaseName = 'max-core') {}
  private open(): Promise<IDBDatabase> {
    if (!this.connection) {
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(this.databaseName, 1);
        let abandoned = false;
        request.onupgradeneeded = () => { request.result.createObjectStore('records'); };
        request.onsuccess = () => {
          const db = request.result;
          if (abandoned) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.connection = undefined; };
          db.onclose = () => { this.connection = undefined; };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => { abandoned = true; reject(new Error('IndexedDB upgrade blocked; close other clients')); };
      }).catch(error => { this.connection = undefined; throw error; });
    }
    return this.connection;
  }
  private async request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      const transaction = db.transaction('records', mode);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => { /* onabort is the terminal event. */ };
      try {
        const request = operation(transaction.objectStore('records'));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { transaction.abort(); reject(error); }
    });
  }
  async get(key: string): Promise<JsonValue | undefined> {
    const value: unknown = await this.request('readonly', store => store.get(key));
    return value === undefined ? undefined : snapshot(value as JsonValue) as JsonValue;
  }
  async set(key: string, value: JsonValue): Promise<void> {
    const copy = snapshot(value) as JsonValue;
    await this.request('readwrite', store => store.put(copy, key));
  }
  async remove(key: string): Promise<void> { await this.request('readwrite', store => store.delete(key)); }
  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    (await connection)?.close();
  }
  /** Safari may invalidate a connection. Reopen and let OfflineStorage restore remote data. */
  async recover(): Promise<void> {
    try { await this.close(); } catch { /* A failed open is already invalidated. */ }
    await this.open();
  }
}
