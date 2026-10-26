import type { Immutable, JsonObject, Unsubscribe } from './common.js';
export type StateListener<T> = (state: Immutable<T>, previous: Immutable<T>) => void;
export interface StateContract<T extends JsonObject> {
  get(): Immutable<T>;
  set(value: T): void;
  /** Shallow merge. Nested values are replaced. */
  patch(delta: Partial<T>): void;
  subscribe(listener: StateListener<T>): Unsubscribe;
  unsubscribe(listener: StateListener<T>): void;
}
