# State engine

## Architecture and responsibilities

`State<T>` owns one immutable JSON object. Every write validates, copies and freezes
before replacing the value. Observers run synchronously in registration order over
a snapshot of subscribers. There is no UI, dashboard or product ownership.

## Public APIs

- `new State(initial)`, `get()`, `set(value)`.
- `patch(partial)` shallow-merges top-level fields; nested objects are replaced.
- `subscribe(listener)` returns an idempotent unsubscribe function.
- `unsubscribe(listener)` removes the same listener identity. Duplicate registration
  of the same function is deduplicated. Initial state is not immediately emitted.
- Listener arguments are `(next, previous)` and are deeply readonly and frozen.

## Example

```ts
const state = new State({ position: { x: 0, y: 0 }, paused: false });
const off = state.subscribe((next, previous) => console.log(next, previous));
state.patch({ position: { x: 1, y: 2 } });
off();
```

## Failure modes

Invalid JSON fails before commit. Observer failures are aggregated after all
observers run; state remains committed. Writes from an observer are rejected to
prevent reentrant, out-of-order notifications. Removing/adding listeners during a
notification affects the next write.

## Recovery

Read `get()` after an observer error before retrying: blindly repeating a committed
write duplicates notifications. Repair or unsubscribe the failing observer.
Queue subsequent writes outside the synchronous observer call. Recover persistent
state through Storage/SyncReplica and validate domain schema before `set`.
