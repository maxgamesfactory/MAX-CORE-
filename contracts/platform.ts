import type { JsonObject, Outcome } from './common.js';
import type { StorageContract } from './storage.js';
import type { TelemetryContract } from './telemetry.js';
export type Platform = 'web' | 'android' | 'ios' | 'desktop' | 'xr' | 'unknown';
export type Browser = 'safari' | 'chrome' | 'samsung' | 'edge' | 'firefox' | 'unknown';
export type Renderer = 'webgpu' | 'webgl' | 'dom' | 'none';
export interface Capabilities {
  platform: Platform; browser: Browser; renderer: Renderer;
  wasm: boolean; webgl: boolean; webgpu: boolean; pwa: boolean;
  persistentStorage: boolean; memoryClass: 'low' | 'medium' | 'high' | 'unknown';
  webkit: boolean; serviceWorker: boolean; webxr: boolean;
}
export interface PlatformPolicy {
  preferredExecution: 'wasm' | 'javascript';
  memorySafeRendering: boolean; imageProxyMode: boolean;
  storageRecovery: boolean; offlineRecovery: boolean;
}
export interface NotificationAdapter { notify(title: string, body: string): Promise<Outcome<void>> }
export interface PurchaseAdapter { purchase(sku: string): Promise<Outcome<{ receipt: string }>> }
export interface DeviceAdapter { info(): Promise<Outcome<JsonObject>> }
export type StorageAdapter = StorageContract;
export type TelemetryAdapter = TelemetryContract;
export interface PlatformAdapterContract {
  readonly platform: Platform;
  readonly capabilities: Readonly<Capabilities>;
  readonly policy: Readonly<PlatformPolicy>;
  readonly storage: StorageAdapter;
  readonly telemetry: TelemetryAdapter;
  readonly notifications: NotificationAdapter;
  readonly purchases: PurchaseAdapter;
  readonly device: DeviceAdapter;
}
export type PlatformAdapter = PlatformAdapterContract;
