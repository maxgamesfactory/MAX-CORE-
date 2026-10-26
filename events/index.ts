import type { EventContract, EventHandler, EventMap, RetryPolicy, Unsubscribe } from '../contracts/index.js';
import { snapshot } from '../state/json.js';

/** One instance routes events across a runtime; inject that instance into all consumers. */
export class EventBus<E extends EventMap> implements EventContract<E> {
  private readonly routes = new Map<keyof E, Set<EventHandler<E[keyof E]>>>();
  constructor(private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {}
  subscribe<K extends keyof E & string>(type: K, handler: EventHandler<E[K]>): Unsubscribe {
    let handlers = this.routes.get(type);
    if (!handlers) { handlers = new Set(); this.routes.set(type, handlers); }
    handlers.add(handler as EventHandler<E[keyof E]>);
    return () => this.unsubscribe(type, handler);
  }
  unsubscribe<K extends keyof E & string>(type: K, handler: EventHandler<E[K]>): void {
    const handlers = this.routes.get(type);
    handlers?.delete(handler as EventHandler<E[keyof E]>);
    if (handlers?.size === 0) this.routes.delete(type);
  }
  async emit<K extends keyof E & string>(type: K, payload: E[K], retry: RetryPolicy = { retries: 0 }): Promise<void> {
    if (!Number.isSafeInteger(retry.retries) || retry.retries < 0 || !Number.isFinite(retry.delayMs ?? 0) || (retry.delayMs ?? 0) < 0) throw new RangeError('Invalid retry policy');
    const data = snapshot(payload);
    const deliveries = [...(this.routes.get(type) ?? [])].map(async handler => {
      for (let attempt = 0; ; attempt++) {
        try { await handler(data); return; }
        catch (error) {
          if (attempt >= retry.retries) throw error;
          if (retry.delayMs) await this.wait(retry.delayMs);
        }
      }
    });
    const results = await Promise.allSettled(deliveries);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
    if (errors.length) throw new AggregateError(errors, 'Event delivery failed');
  }
}
