import type { DeepReadonly, JsonObject, JsonValue, StateContract, StateListener, StorageContract } from '../contracts/index.js';
import { Serial, snapshot } from '../contracts/value.js';

export interface StatePersistence<T> {
  storage: StorageContract;
  key: string;
  /** Required validation/migration boundary for persisted, untrusted data. */
  decode(value: JsonValue): T;
}
export class State<T extends JsonObject> implements StateContract<T> {
  private value: DeepReadonly<T>;
  private readonly listeners = new Set<StateListener<T>>();
  private readonly serial = new Serial();
  constructor(initial: T, private readonly persistence?: StatePersistence<T>) {
    this.value = snapshot(initial);
  }
  get(): DeepReadonly<T> { return this.value; }
  set(value: T): Promise<void> {
    const next = snapshot(value);
    return this.serial.run(() => this.commit(next));
  }
  patch(value: Partial<T>): Promise<void> {
    const patch = snapshot(value as JsonObject) as unknown as JsonObject;
    return this.serial.run(() => this.commit(snapshot<JsonObject>({ ...(this.value as unknown as JsonObject), ...patch } as JsonObject) as unknown as DeepReadonly<T>));
  }
  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }
  unsubscribe(listener: StateListener<T>): void { this.listeners.delete(listener); }
  rehydrate(): Promise<boolean> {
    return this.serial.run(async () => {
      if (!this.persistence) return false;
      const stored = await this.persistence.storage.get(this.persistence.key);
      if (stored === undefined) return false;
      this.publish(snapshot(this.persistence.decode(stored)));
      return true;
    });
  }
  private async commit(next: DeepReadonly<T>): Promise<void> {
    if (this.persistence) await this.persistence.storage.set(this.persistence.key, next as unknown as JsonValue);
    this.publish(next);
  }
  private publish(next: DeepReadonly<T>): void {
    const previous = this.value;
    this.value = next;
    const errors: unknown[] = [];
    for (const listener of [...this.listeners]) {
      try { listener(next, previous); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'State committed; subscriber failures');
  }
}
