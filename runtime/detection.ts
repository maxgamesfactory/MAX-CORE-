import type { Platform } from '../contracts/index.js';

export interface DetectionEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  nativePlatform?: Platform;
  wasm?: boolean;
  webgpu?: boolean;
  webgl?: boolean;
  standalone?: boolean;
  persistence?: { persisted(): Promise<boolean> };
  indexedDB?: boolean;
}
export type Browser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'unknown';
/** Call only at the host boundary. Importing core never probes browser globals. */
export function browserEnvironment(): DetectionEnvironment {
  const nav = globalThis.navigator;
  let webgl = false;
  try {
    const canvas = globalThis.document?.createElement('canvas');
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    webgl = !!context;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* Disabled graphics contexts are a supported environment. */ }
  let indexedDB = false;
  try { indexedDB = !!globalThis.indexedDB; } catch { /* Storage can be policy-blocked. */ }
  return {
    userAgent: nav?.userAgent ?? '', platform: nav?.platform ?? '', maxTouchPoints: nav?.maxTouchPoints ?? 0,
    wasm: typeof WebAssembly !== 'undefined', webgpu: !!nav && 'gpu' in nav, webgl, indexedDB,
    standalone: (typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(display-mode: standalone)').matches)
      || (!!nav && 'standalone' in nav && nav.standalone === true),
    ...(nav?.storage ? { persistence: nav.storage } : {}),
  };
}
export function detectPlatform(env: DetectionEnvironment = browserEnvironment()): Platform {
  if (env.nativePlatform) return env.nativePlatform;
  const ua = env.userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/mac/i.test(env.platform ?? '') && (env.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (/electron/i.test(ua)) return 'desktop';
  return /mozilla|safari|chrome|firefox/i.test(ua) ? 'web' : 'unknown';
}
export function detectBrowser(env: DetectionEnvironment = browserEnvironment()): Browser {
  const ua = env.userAgent ?? '';
  if (/edg(?:e|a|ios)?\//i.test(ua)) return 'edge';
  if (/firefox|fxios/i.test(ua)) return 'firefox';
  if (/chrome|chromium|crios/i.test(ua)) return 'chrome';
  if (/safari/i.test(ua)) return 'safari';
  return 'unknown';
}
export function detectRenderer(env: DetectionEnvironment = browserEnvironment()): { wasm: boolean; webgl: boolean; webgpu: boolean } {
  return { wasm: env.wasm === true, webgl: env.webgl === true, webgpu: env.webgpu === true };
}
export async function detectPersistence(env: DetectionEnvironment = browserEnvironment()): Promise<boolean> {
  try { return env.indexedDB === true && (await env.persistence?.persisted()) === true; } catch { return false; }
}
export async function detectRuntime(env: DetectionEnvironment = browserEnvironment()) {
  const platform = detectPlatform(env);
  const browser = detectBrowser(env);
  const renderer = detectRenderer(env);
  // iOS alternate browser brands may still use WebKit; apply conservative safeguards.
  const safe = browser === 'safari' || platform === 'ios';
  return {
    platform, browser, ...renderer, pwa: env.standalone === true,
    persistentStorage: await detectPersistence(env),
    policy: {
      memorySafeMode: safe, storageSafeMode: safe, imageFallbackMode: safe,
      compute: platform === 'android' && renderer.wasm ? 'wasm' as const : 'javascript' as const,
      renderer: platform === 'android' && renderer.webgpu ? 'webgpu' as const
        : renderer.webgl && !safe ? 'webgl' as const : 'image' as const,
    },
  };
}
