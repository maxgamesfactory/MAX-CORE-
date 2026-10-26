# Contracts

## Architecture and responsibilities

`contracts/` is the type-only public boundary. It describes data, capabilities,
execution and adapters without implementing behavior. Imports from the contracts
package entry erase completely at build time.

## Public APIs

- `StateContract<T>`: get, set, patch, subscribe, unsubscribe.
- `EventContract<E>`: emit, subscribe, unsubscribe; `RetryPolicy`, event handler types.
- `SimulationContract<S>`: get, start, pause, resume, stop, update; configuration,
  frame, reducer and lifecycle types.
- `StorageContract`: get, set, remove, keys. `SynchronizationContract`: rehydrate,
  get, set, remove, flush, pending. `SyncTransport`, deltas and logical versions.
- `RuntimeContract`: register, resolve, start, stop, spawn; `ExecutionContext`,
  `RuntimeService` and `ProcessHandle`.
- `PlatformAdapterContract` (alias `PlatformAdapter`): capabilities, policy, storage,
  telemetry, notification, purchase and device interfaces.
- `TelemetryContract`: capture a typed portable metric/diagnostic event.
- `XRContract`: active, start, stop. `XRBridge`/`XRSessionBridge` translate hosts.
- JSON, immutable data, outcomes, platform/browser/renderer and unsubscribe types.
- Structural Durable Object/D1 bindings avoid vendor SDK dependencies.

## Example

```ts
import type { StorageContract, PlatformAdapter } from '@max-ecosystem/core/contracts';
async function persist(adapter: PlatformAdapter, storage: StorageContract) {
  await storage.set('capabilities', { renderer: adapter.capabilities.renderer });
}
```

## Failure modes and recovery

TypeScript catches incompatible API usage; JavaScript callers still need runtime
validation. JSON validation is implemented in engines/drivers. Storage generic
return types and named service resolution do not validate product schemas. Use
application schema validation after rehydration. Evolve incompatible contracts
with a versioned API and data migration; never silently change persisted formats.
