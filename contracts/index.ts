/** Portable payloads deliberately exclude host objects, undefined, and functions. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type ReadonlyJsonValue = null | boolean | number | string | readonly ReadonlyJsonValue[] | { readonly [key: string]: ReadonlyJsonValue };
export type DeepReadonly<T> = JsonValue extends T ? ReadonlyJsonValue
  : T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;
export type Unsubscribe = () => void;
export type StateListener<T> = (current: DeepReadonly<T>, previous: DeepReadonly<T>) => void;

/** Updates serialize; persistence commits before observers see a new snapshot. */
export interface StateContract<T extends JsonObject> {
  get(): DeepReadonly<T>;
  set(value: T): Promise<void>;
  patch(value: Partial<T>): Promise<void>;
  subscribe(listener: StateListener<T>): Unsubscribe;
  unsubscribe(listener: StateListener<T>): void;
  rehydrate(): Promise<boolean>;
}
/** Each event name is bound to exactly one payload type. */
export interface EventContract<E extends { [K in keyof E]: JsonValue }> {
  emit<K extends keyof E>(name: K, payload: E[K]): void;
  subscribe<K extends keyof E>(name: K, listener: (payload: DeepReadonly<E[K]>) => void): Unsubscribe;
  unsubscribe<K extends keyof E>(name: K, listener: (payload: DeepReadonly<E[K]>) => void): void;
}
export type SimulationStatus = 'stopped' | 'running' | 'paused';
/** update advances one fixed step; the caller owns the clock. */
export interface SimulationContract<S extends JsonValue> {
  readonly status: SimulationStatus;
  readonly tick: number;
  get(): DeepReadonly<S>;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  update(): DeepReadonly<S>;
}
/** Implementations must atomically replace a key or reject without a partial write. */
export interface StorageContract {
  get(key: string): Promise<JsonValue | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface StorageAdapter extends StorageContract { readonly persistent: boolean }
export type Platform = 'web' | 'ios' | 'android' | 'desktop' | 'unknown';
export interface PlatformAdapter { readonly platform: Platform }
export interface TelemetryAdapter { track(name: string, properties: JsonObject): Promise<void> }
export interface NotificationAdapter { notify(message: { title: string; body: string }): Promise<void> }
export interface PurchaseAdapter {
  purchase(productId: string): Promise<{ transactionId: string; productId: string }>;
}
/** Capabilities are explicit, injected, and never imported from a product. */
export interface AdapterContract extends PlatformAdapter {
  readonly storage: StorageAdapter;
  readonly telemetry: TelemetryAdapter;
  readonly notifications: NotificationAdapter;
  readonly purchases: PurchaseAdapter;
}
export interface Service {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}
export type RuntimeStatus = 'stopped' | 'starting' | 'running' | 'stopping';
export interface RuntimeContract {
  readonly status: RuntimeStatus;
  register(name: string, service: Service): void;
  boot(): Promise<void>;
  shutdown(): Promise<void>;
}
