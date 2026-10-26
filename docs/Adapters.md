# Platform adapters

Web, iOS, Android, and desktop expose one `AdapterContract`. Every factory supplies
`PlatformAdapter` via `.platform`, and `StorageAdapter`, `TelemetryAdapter`,
`NotificationAdapter`, and `PurchaseAdapter` via the corresponding properties.

| Factory | Platform | Storage example |
| --- | --- | --- |
| `createWebAdapter` | web | IndexedDBStorage |
| `createIosAdapter` | ios | Host SQLite/file bridge |
| `createAndroidAdapter` | android | Host SQLite/file bridge |
| `createDesktopAdapter` | desktop | Host SQLite/file bridge or IndexedDB |

```ts
import { createWebAdapter, IndexedDBStorage } from '@max/core';
const adapter = createWebAdapter({
  storage: new IndexedDBStorage(globalThis.indexedDB),
  telemetry: { async track(name, properties) { /* host transport */ } },
  notifications: { async notify(message) { /* host permission + notification */ } },
  purchases: {
    async purchase(productId) {
      // Replace with the host's verified purchase bridge.
      throw new Error(`Purchase host not configured for ${productId}`);
    },
  },
});
```

Storage is required. The core never silently falls back from durable storage to
memory. `MemoryStorage` is explicitly volatile (`persistent = false`) and useful
for tests or intentional nonpersistent sessions. A native bridge must provide
atomic, durable per-key writes and preserve portable JSON.

Telemetry, notifications, and purchases are optional. Missing capabilities reject
with `UnsupportedCapabilityError`; no purchases or deliveries are simulated as
successful. An adapter is a host boundary, not a native SDK implementation.
Notification permissions, user interaction, receipt verification, purchase
restoration, telemetry consent/batching, and native SDK initialization belong in
the host. Keep product IDs, account policies, and UI outside MAX-CORE.

An adapter is frozen after creation. Services behind its properties own their
lifecycle. SDK bridges should register cleanup services with the runtime if
needed. Inject the same adapter into dependent systems to avoid global state.

All factories are checked against the same typed interface and tested with
synthetic host implementations. Native device tests must be supplied by the host
app; this repository contains no Android/iOS application, signing, SDK, or UI.
