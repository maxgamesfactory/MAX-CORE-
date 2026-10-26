import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRuntime, detectBrowser, detectPlatform, MemoryStorage, createWebAdapter, createIosAdapter, createAndroidAdapter, createDesktopAdapter, UnsupportedCapabilityError } from '../dist/index.js';

test('detection handles Safari, iPad desktop UA, Android and headless runtimes', async () => {
  const safari = await detectRuntime({ userAgent: 'Mozilla/5.0 Version/18.0 Safari/605.1.15', webgl: true, wasm: true, indexedDB: true, persistence: { persisted: async () => { throw new Error('denied'); } } });
  assert.equal(safari.browser, 'safari');
  assert.equal(safari.persistentStorage, false);
  assert.equal(safari.policy.memorySafeMode, true);
  assert.equal(safari.policy.storageSafeMode, true);
  assert.equal(safari.policy.imageFallbackMode, true);
  assert.equal(safari.policy.renderer, 'image');
  const android = await detectRuntime({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Safari/537.36', wasm: true, webgpu: true, standalone: true, indexedDB: true, persistence: { persisted: async () => true } });
  assert.equal(android.platform, 'android'); assert.equal(android.browser, 'chrome');
  assert.equal(android.policy.compute, 'wasm'); assert.equal(android.policy.renderer, 'webgpu');
  assert.equal(android.pwa, true); assert.equal(android.persistentStorage, true);
  assert.equal(detectPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(detectBrowser({ userAgent: 'Safari/605 CriOS/130' }), 'chrome');
  assert.equal(detectBrowser({ userAgent: 'Chrome/130 Edg/130' }), 'edge');
  assert.equal(detectBrowser({ userAgent: 'Safari/605 FxiOS/130' }), 'firefox');
  assert.equal(detectPlatform({ nativePlatform: 'desktop' }), 'desktop');
  const unknown = await detectRuntime({});
  assert.equal(unknown.platform, 'unknown'); assert.equal(unknown.wasm, false);
  await detectRuntime(); // Safe in Node with no document.
});

test('every platform shares the adapter contracts and explicit capability failures', async () => {
  for (const [platform, create] of [['web', createWebAdapter], ['ios', createIosAdapter], ['android', createAndroidAdapter], ['desktop', createDesktopAdapter]]) {
    const calls = [];
    const adapter = create({ storage: new MemoryStorage(), telemetry: { track: async (...args) => { calls.push(args); } }, notifications: { notify: async message => { calls.push(message); } }, purchases: { purchase: async productId => ({ productId, transactionId: 'test-id' }) } });
    assert.equal(adapter.platform, platform);
    await adapter.storage.set('a', 1); assert.equal(await adapter.storage.get('a'), 1);
    await adapter.telemetry.track('event', {}); await adapter.notifications.notify({ title: 'title', body: 'body' });
    assert.equal(calls.length, 2);
    assert.equal((await adapter.purchases.purchase('sku')).productId, 'sku');
    const minimal = create({ storage: new MemoryStorage() });
    await assert.rejects(minimal.purchases.purchase('sku'), UnsupportedCapabilityError);
    await assert.rejects(minimal.telemetry.track('event', {}), UnsupportedCapabilityError);
    await assert.rejects(minimal.notifications.notify({ title: '', body: '' }), UnsupportedCapabilityError);
  }
});
