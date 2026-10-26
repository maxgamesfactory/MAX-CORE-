# Detection and platform adapters

## Architecture and responsibilities

Adapters translate platform capabilities and host services to contracts. They own
no game, product, dashboard or simulation behavior. Modules have no import-time
browser access. `DetectionEnvironment` provides injectable probes for native hosts
and tests. `hostEnvironment()` lazily reads available browser/runtime globals.

## Public APIs

- `detectPlatform`: XR identifiers first, Android, iOS (including touch Mac iPad),
  desktop user agents, web DOM, then unknown. Detection is advisory; native hosts
  should call their explicit adapter factory.
- `detectBrowser`: Samsung, Edge (desktop/Android/iOS), Chrome/CriOS, Firefox/FxiOS,
  Safari, unknown. WebKit is a separate capability, including iOS browser variants.
- `detectRenderer` (async): successful GPU adapter, WebGL probe, DOM, none. Failed
  probes are contained; WebGL contexts used for probing are released when possible.
- `detectStorage` (async): IndexedDB API presence and `persisted()` result. Presence
  does not prove a later write will succeed.
- `detectMemoryProfile`: <=2 GiB low, <=4 medium, >4 high, missing/invalid unknown.
- `detectRuntime`: browser, worker, node, deno, bun, native or unknown.
- `detectCapabilities` (async): `{ platform, browser, renderer, wasm, webgl, webgpu,
  pwa, persistentStorage, memoryClass, webkit, serviceWorker, webxr }`.
- `createPlatformAdapter(platform, options?)` and factories `createWebAdapter`,
  `createAndroidAdapter`, `createIosAdapter`, `createDesktopAdapter`, `createXrAdapter`.
  Every adapter supplies PlatformAdapter, StorageAdapter, TelemetryAdapter,
  NotificationAdapter, PurchaseAdapter and DeviceAdapter through composition.

Options inject environment, storage, telemetry, notifications, purchases and device.
Default storage is IndexedDB when present, otherwise ephemeral memory. Default
telemetry is a no-op; notification and purchase calls report unsupported. Device
info defaults to platform/runtime metadata. Factories return frozen capabilities
and policy snapshots. Factories use explicit platform identity even if a browser
user-agent suggests another platform.

## Example

```ts
const adapter = await createIosAdapter({ storage: nativeStorage,
  notifications: nativeNotifications, purchases: nativePurchases,
  device: nativeDevice, telemetry: hostTelemetry });
if (adapter.capabilities.renderer === 'dom') { /* host selects DOM renderer */ }
if (adapter.policy.memorySafeRendering) { /* host limits render resources */ }
const purchase = await adapter.purchases.purchase('host-owned-sku');
if (!purchase.supported) console.log(purchase.reason);
```

## Failure modes and recovery

UA/runtime probes are hints, not guarantees. Browser spoofing, GPU loss, permission
changes and storage eviction remain possible. Unknown memory uses conservative
policy. iOS sets imageProxyMode and recovery policies; hosts provide the image
proxy, renderer, storage repair and offline shell. Android prefers WASM only when
available; the host supplies WASM binaries and chooses execution strategy.

Native adapter services require host bridges and entitlements, implemented outside
core. Inject or replace bridges at composition time after permissions are granted.
Catch storage errors and preserve queued changes. A renderer failure must choose
an available fallback or suspend rendering while engines continue; never throw
merely because WebGPU/WebGL is unavailable. Re-run capability probes after host
changes; existing adapters intentionally retain their original snapshot.
