import type { Immutable, JsonValue, Unsubscribe } from './common.js';
export type EventMap = Record<string, JsonValue>;
export type EventHandler<T> = (payload: Immutable<T>) => void | Promise<void>;
export interface RetryPolicy { retries: number; delayMs?: number }
export interface EventContract<E extends EventMap> {
  /** Retries each failing subscriber independently; rejects after all deliveries settle. */
  emit<K extends keyof E & string>(type: K, payload: E[K], retry?: RetryPolicy): Promise<void>;
  subscribe<K extends keyof E & string>(type: K, handler: EventHandler<E[K]>): Unsubscribe;
  unsubscribe<K extends keyof E & string>(type: K, handler: EventHandler<E[K]>): void;
}
