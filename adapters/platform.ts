import type { Capabilities, DeviceAdapter, NotificationAdapter, Platform, PlatformAdapterContract, PurchaseAdapter, StorageContract, TelemetryContract } from '../contracts/index.js';
import { MemoryStorage } from '../storage/memory.js';
import { IndexedDBStorage } from '../storage/indexeddb.js';
import { detectCapabilities, hostEnvironment } from './detection.js';
import type { DetectionEnvironment } from './detection.js';

export interface AdapterOptions {
  environment?: DetectionEnvironment;
  storage?: StorageContract;
  telemetry?: TelemetryContract;
  notifications?: NotificationAdapter;
  purchases?: PurchaseAdapter;
  device?: DeviceAdapter;
}
export async function createPlatformAdapter(platform: Platform, options: AdapterOptions = {}): Promise<PlatformAdapterContract> {
  const env = options.environment ?? hostEnvironment();
  const detected = await detectCapabilities(env);
  const capabilities: Capabilities = { ...detected, platform };
  const memorySafeRendering = platform === 'ios' || capabilities.memoryClass === 'low' || capabilities.memoryClass === 'unknown';
  return Object.freeze({
    platform, capabilities: Object.freeze(capabilities),
    policy: Object.freeze({ preferredExecution: capabilities.wasm ? 'wasm' as const : 'javascript' as const,
      memorySafeRendering, imageProxyMode: platform === 'ios', storageRecovery: true, offlineRecovery: true }),
    storage: options.storage ?? (env.indexedDB ? new IndexedDBStorage('max-core', env.indexedDB) : new MemoryStorage()),
    telemetry: options.telemetry ?? { capture: () => undefined },
    notifications: options.notifications ?? { notify: async () => ({ supported: false as const, reason: 'Notification bridge unavailable' }) },
    purchases: options.purchases ?? { purchase: async () => ({ supported: false as const, reason: 'Purchase bridge unavailable' }) },
    device: options.device ?? { info: async () => ({ supported: true as const, value: { platform, runtime: env.runtime ?? 'unknown' } }) }
  });
}
