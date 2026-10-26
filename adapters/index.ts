import type { AdapterContract, JsonObject, NotificationAdapter, Platform, PurchaseAdapter, StorageAdapter, TelemetryAdapter } from '../contracts/index.js';

export class UnsupportedCapabilityError extends Error {
  constructor(capability: string) { super(`Host does not support ${capability}`); this.name = 'UnsupportedCapabilityError'; }
}
export interface HostCapabilities {
  storage: StorageAdapter;
  telemetry?: TelemetryAdapter;
  notifications?: NotificationAdapter;
  purchases?: PurchaseAdapter;
}
/** All platforms use the same contracts. Native SDK objects stay in the host. */
export function createAdapter(platform: Platform, host: HostCapabilities): AdapterContract {
  return Object.freeze({
    platform, storage: host.storage,
    telemetry: host.telemetry ?? { async track(_name: string, _properties: JsonObject) { throw new UnsupportedCapabilityError('telemetry'); } },
    notifications: host.notifications ?? { async notify() { throw new UnsupportedCapabilityError('notifications'); } },
    purchases: host.purchases ?? { async purchase() { throw new UnsupportedCapabilityError('purchases'); } },
  });
}
