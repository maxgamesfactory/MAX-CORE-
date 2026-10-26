import type { DeepReadonly, JsonValue } from './index.js';

/** Validate at public boundaries, clone and freeze so callers retain no mutable alias. */
export function snapshot<T extends JsonValue>(value: T): DeepReadonly<T> {
  return cloneJson(value) as unknown as DeepReadonly<T>;
}
export function cloneJson(value: JsonValue): JsonValue {
  const seen = new Set<object>();
  function copy(input: unknown): JsonValue {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || input === null || seen.has(input)) throw new TypeError('Expected acyclic JSON data');
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
      throw new TypeError('Expected a plain object');
    }
    seen.add(input);
    const result: JsonValue = Array.isArray(input)
      ? Array.from(input, copy)
      : Object.fromEntries(Object.entries(input).map(([key, item]) => [key, copy(item)]));
    seen.delete(input);
    return Object.freeze(result) as JsonValue;
  }
  return copy(value);
}
/** Serializes asynchronous mutations and allows retries after a rejected operation. */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
