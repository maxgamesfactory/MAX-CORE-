import type { Browser, Capabilities, Platform, Renderer } from '../contracts/index.js';

/** Inject host probes for native runtimes and deterministic tests. No globals read at import. */
export interface DetectionEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  wasm?: boolean;
  standalone?: boolean;
  serviceWorker?: boolean;
  webxr?: boolean;
  hasDOM?: boolean;
  indexedDB?: IDBFactory;
  persisted?: () => Promise<boolean>;
  requestGPUAdapter?: () => Promise<unknown>;
  webgl?: () => boolean;
  runtime?: 'browser' | 'worker' | 'node' | 'deno' | 'bun' | 'native' | 'unknown';
}
export function hostEnvironment(): DetectionEnvironment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const doc = typeof document === 'undefined' ? undefined : document;
  const extended = nav as (Navigator & { deviceMemory?: number; standalone?: boolean; gpu?: { requestAdapter(): Promise<unknown> }; xr?: unknown }) | undefined;
  const globals = globalThis as typeof globalThis & { process?: { versions?: { node?: string; bun?: string } }; Deno?: unknown; WorkerGlobalScope?: unknown };
  return {
    userAgent: nav?.userAgent ?? '', platform: nav?.platform ?? '', maxTouchPoints: nav?.maxTouchPoints ?? 0,
    ...(extended?.deviceMemory === undefined ? {} : { deviceMemory: extended.deviceMemory }),
    wasm: typeof WebAssembly !== 'undefined',
    standalone: extended?.standalone === true || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches),
    serviceWorker: !!nav && 'serviceWorker' in nav, webxr: !!extended?.xr, hasDOM: !!doc,
    ...(typeof indexedDB === 'undefined' ? {} : { indexedDB }),
    ...(nav?.storage?.persisted ? { persisted: () => nav.storage.persisted() } : {}),
    ...(extended?.gpu ? { requestGPUAdapter: () => extended.gpu!.requestAdapter() } : {}),
    webgl: () => {
      if (!doc) return false;
      const canvas = doc.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    },
    runtime: globals.process?.versions?.bun ? 'bun' : globals.Deno ? 'deno' : globals.process?.versions?.node ? 'node' : doc ? 'browser' : globals.WorkerGlobalScope ? 'worker' : 'unknown'
  };
}
export function detectPlatform(env: DetectionEnvironment = hostEnvironment()): Platform {
  const ua = env.userAgent ?? '';
  if (/OculusBrowser|Quest|OpenXR|VisionPro/i.test(ua)) return 'xr';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(env.platform ?? '') && (env.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return 'desktop';
  return env.hasDOM ? 'web' : 'unknown';
}
export function detectBrowser(env: DetectionEnvironment = hostEnvironment()): Browser {
  const ua = env.userAgent ?? '';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg(?:e|A|iOS)?\//i.test(ua)) return 'edge';
  if (/Chrome|CriOS/i.test(ua)) return 'chrome';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/Safari/i.test(ua)) return 'safari';
  return 'unknown';
}
function webglAvailable(env: DetectionEnvironment): boolean {
  try { return env.webgl?.() ?? false; } catch { return false; }
}
export async function detectRenderer(env: DetectionEnvironment = hostEnvironment()): Promise<Renderer> {
  try { if (await env.requestGPUAdapter?.()) return 'webgpu'; } catch { /* Try another renderer. */ }
  return webglAvailable(env) ? 'webgl' : env.hasDOM ? 'dom' : 'none';
}
export async function detectStorage(env: DetectionEnvironment = hostEnvironment()): Promise<{ indexedDB: boolean; persistentStorage: boolean }> {
  let persistentStorage = false;
  try { persistentStorage = await env.persisted?.() ?? false; } catch { /* Permission or host failure. */ }
  return { indexedDB: !!env.indexedDB, persistentStorage };
}
export function detectMemoryProfile(env: DetectionEnvironment = hostEnvironment()): Capabilities['memoryClass'] {
  const memory = env.deviceMemory;
  if (memory === undefined || !Number.isFinite(memory) || memory <= 0) return 'unknown';
  return memory <= 2 ? 'low' : memory <= 4 ? 'medium' : 'high';
}
export function detectRuntime(env: DetectionEnvironment = hostEnvironment()): NonNullable<DetectionEnvironment['runtime']> { return env.runtime ?? 'unknown'; }
export async function detectCapabilities(env: DetectionEnvironment = hostEnvironment()): Promise<Capabilities> {
  const renderer = await detectRenderer(env);
  const storage = await detectStorage(env);
  const platform = detectPlatform(env);
  return {
    platform, browser: detectBrowser(env), renderer, wasm: env.wasm ?? false,
    webgl: renderer === 'webgl' || (renderer === 'webgpu' && webglAvailable(env)), webgpu: renderer === 'webgpu',
    pwa: env.standalone ?? false, persistentStorage: storage.persistentStorage,
    memoryClass: detectMemoryProfile(env),
    webkit: /AppleWebKit/i.test(env.userAgent ?? '') && (!/Chrome|Chromium|Edg\//i.test(env.userAgent ?? '') || platform === 'ios'),
    serviceWorker: env.serviceWorker ?? false, webxr: env.webxr ?? false
  };
}
