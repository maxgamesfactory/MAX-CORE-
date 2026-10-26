import type { DeepReadonly, EventContract, JsonValue, Unsubscribe } from '../contracts/index.js';
import { cloneJson } from '../contracts/value.js';

/** Share one instance in the composition root for global, typed routing. */
export class EventBus<E extends { [K in keyof E]: JsonValue }> implements EventContract<E> {
  private readonly listeners = new Map<keyof E, Set<(payload: never) => void>>();
  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const immutable = cloneJson(payload);
    const errors: unknown[] = [];
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try { listener(immutable as unknown as never); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Event subscriber failures');
  }
  subscribe<K extends keyof E>(name: K, listener: (payload: DeepReadonly<E[K]>) => void): Unsubscribe {
    const handlers = this.listeners.get(name) ?? new Set();
    handlers.add(listener as unknown as (payload: never) => void);
    this.listeners.set(name, handlers);
    const raw = listener as unknown as (payload: never) => void;
    return () => {
      handlers.delete(raw);
      if (!handlers.size && this.listeners.get(name) === handlers) this.listeners.delete(name);
    };
  }
  unsubscribe<K extends keyof E>(name: K, listener: (payload: DeepReadonly<E[K]>) => void): void {
    const handlers = this.listeners.get(name);
    handlers?.delete(listener as unknown as (payload: never) => void);
    if (!handlers?.size) this.listeners.delete(name);
  }
}
export { EventBus as Event };
