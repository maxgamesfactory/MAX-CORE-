# Event bus

## Architecture and responsibilities

`EventBus<E>` routes typed JSON payloads through a shared runtime instance. Event
names and payload types come from the caller's map. Subscribers run concurrently;
emit waits for every delivery, including independent retries. No workflows live
in the bus. Inject the same bus for global routing within a runtime. Cross-device
or cross-worker routing requires a host transport.

## Public APIs and example

```ts
const events = new EventBus<{ changed: { id: string } }>();
const handle = async (payload: { readonly id: string }) => console.log(payload.id);
const off = events.subscribe('changed', handle);
await events.emit('changed', { id: 'sample' }, { retries: 2, delayMs: 5 });
events.unsubscribe('changed', handle);
off(); // safe repeatedly
```

Payloads are copied/frozen before asynchronous work. Subscriptions are snapshotted
per emit. Duplicate function registrations are deduplicated. No subscribers is a
successful no-op. `retries` is additional attempts, not total attempts; default is
zero, with no delay. The constructor accepts a portable asynchronous delay function.

## Failure modes

Invalid payloads/policies reject emit. Subscriber rejections are aggregated only
after all deliveries settle. Successful subscribers are never retried. Retries
provide at-least-once delivery to a failing subscriber: partial side effects can
repeat. There is no durable delivery queue, timeout, ordering across concurrent
emits, or implicit cancellation.

## Recovery

Subscribers that use retries must be idempotent or deduplicate with product-owned
IDs. Catch an emit failure at the calling boundary and report diagnostics. Do not
have a handler await a recursively emitted event that depends on itself.
Unsubscribe observers when their owner stops.
