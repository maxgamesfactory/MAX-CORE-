export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type Immutable<T> = T extends JsonPrimitive ? T : T extends readonly (infer V)[] ? readonly Immutable<V>[] : { readonly [K in keyof T]: Immutable<T[K]> };
export type Unsubscribe = () => void;
export type Outcome<T> = { supported: true; value: T } | { supported: false; reason: string };
