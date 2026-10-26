import type { Immutable, JsonValue } from '../contracts/common.js';

/** Validate, copy and freeze JSON data; never retain caller-owned references. */
export function cloneJson(value: JsonValue): JsonValue {
  const seen = new Set<object>();
  const copy = (item: unknown): JsonValue => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null || seen.has(item)) throw new TypeError('Expected finite, acyclic JSON data');
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Expected plain JSON objects');
    seen.add(item);
    const result: JsonValue = Array.isArray(item)
      ? Array.from(item, copy)
      : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, copy(child)]));
    seen.delete(item);
    return Object.freeze(result) as JsonValue;
  };
  return copy(value);
}

export function snapshot<T extends JsonValue>(value: T): Immutable<T> {
  return cloneJson(value) as unknown as Immutable<T>;
}
