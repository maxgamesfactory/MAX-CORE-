import type { Immutable, JsonObject, StateContract, StateListener, Unsubscribe } from '../contracts/index.js';
import { snapshot } from './json.js';

export class State<T extends JsonObject> implements StateContract<T> {
  private value: Immutable<T>;
  private readonly listeners = new Set<StateListener<T>>();
  private notifying = false;
  constructor(initial: T) { this.value = snapshot(initial); }
  get(): Immutable<T> { return this.value; }
  set(value: T): void {
    if (this.notifying) throw new Error('State writes during notification are not allowed');
    const next = snapshot(value);
    const previous = this.value;
    this.value = next;
    const errors: unknown[] = [];
    this.notifying = true;
    try {
      for (const listener of [...this.listeners]) {
        try { listener(next, previous); } catch (error) { errors.push(error); }
      }
    } finally { this.notifying = false; }
    if (errors.length) throw new AggregateError(errors, 'State committed; one or more listeners failed');
  }
  patch(delta: Partial<T>): void { this.set({ ...(this.value as T), ...delta } as T); }
  subscribe(listener: StateListener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }
  unsubscribe(listener: StateListener<T>): void { this.listeners.delete(listener); }
}
