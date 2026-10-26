import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createAndroidAdapter, createDesktopAdapter, createIosAdapter, createPlatformAdapter, createWebAdapter, createXrAdapter, detectBrowser, detectCapabilities, detectMemoryProfile, detectPlatform, detectRenderer, detectRuntime, detectStorage, EventBus, hostEnvironment, IndexedDBStorage, MemoryStorage, Simulation, State, WebXRBridge, XRIntegration } from '../index.js';
import type { DetectionEnvironment, JsonObject, WebXRInputEvent, WebXRSession, WebXRSystem, XRBridge, XREvents, XRSessionBridge } from '../index.js';

afterEach(() => vi.unstubAllGlobals());
describe('platform and runtime detection', () => {
  it.each([
    [{ userAgent: 'OculusBrowser Quest Android' }, 'xr'], [{ userAgent: 'VisionPro' }, 'xr'],
    [{ userAgent: 'Android Chrome' }, 'android'], [{ userAgent: 'iPhone' }, 'ios'],
    [{ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }, 'ios'],
    [{ userAgent: 'Windows' }, 'desktop'], [{ userAgent: 'Linux X11' }, 'desktop'],
    [{ hasDOM: true }, 'web'], [{}, 'unknown']
  ] as [DetectionEnvironment, string][])('detects platform %j', (env, expected) => expect(detectPlatform(env)).toBe(expected));
  it.each([
    ['SamsungBrowser Chrome', 'samsung'], ['Edg/100 Chrome', 'edge'], ['EdgA/100 Chrome', 'edge'], ['EdgiOS/100', 'edge'],
    ['Chrome Safari', 'chrome'], ['CriOS Safari', 'chrome'], ['Firefox', 'firefox'], ['FxiOS', 'firefox'], ['Safari AppleWebKit', 'safari'], ['', 'unknown']
  ])('detects browser %s', (userAgent, expected) => expect(detectBrowser({ userAgent })).toBe(expected));
  it.each([[undefined, 'unknown'], [NaN, 'unknown'], [-1, 'unknown'], [0, 'unknown'], [2, 'low'], [4, 'medium'], [8, 'high']])('detects memory class %s', (deviceMemory, expected) => {
    expect(detectMemoryProfile(deviceMemory === undefined ? {} : { deviceMemory })).toBe(expected);
  });
  it('falls through failed renderer probes to DOM or no rendering', async () => {
    expect(await detectRenderer({ requestGPUAdapter: async () => ({}), webgl: () => true })).toBe('webgpu');
    expect(await detectRenderer({ requestGPUAdapter: async () => null, webgl: () => true })).toBe('webgl');
    expect(await detectRenderer({ requestGPUAdapter: async () => { throw new Error(); }, webgl: () => { throw new Error(); }, hasDOM: true })).toBe('dom');
    expect(await detectRenderer({})).toBe('none');
  });
  it('reports capabilities and denied storage access without throwing', async () => {
    const env: DetectionEnvironment = { userAgent: 'iPhone AppleWebKit CriOS Safari', wasm: true, standalone: true, serviceWorker: true, webxr: true, requestGPUAdapter: async () => ({}), webgl: () => true, persisted: async () => true, indexedDB: new IDBFactory(), deviceMemory: 2 };
    expect(await detectCapabilities(env)).toMatchObject({ platform: 'ios', browser: 'chrome', webkit: true, webgpu: true, webgl: true, wasm: true, pwa: true, persistentStorage: true, memoryClass: 'low', serviceWorker: true, webxr: true });
    expect(await detectStorage({ persisted: async () => { throw new Error('denied'); } })).toEqual({ indexedDB: false, persistentStorage: false });
    expect(await detectStorage({})).toEqual({ indexedDB: false, persistentStorage: false });
    expect((await detectCapabilities({ userAgent: 'Chrome AppleWebKit' })).webkit).toBe(false);
    expect((await detectCapabilities({ requestGPUAdapter: async () => ({}), webgl: () => false })).webgl).toBe(false);
    expect(detectRuntime({})).toBe('unknown'); expect(detectRuntime({ runtime: 'native' })).toBe('native');
  });
  it('is safe to import and probe in Node without browser globals', async () => {
    expect(hostEnvironment().runtime).toBe('node'); expect(detectRuntime()).toBe('node'); expect(detectPlatform()).toBe('unknown'); expect(detectBrowser()).toBe('unknown');
    expect(await detectRenderer()).toBe('none'); expect((await detectStorage()).persistentStorage).toBe(false); expect(detectMemoryProfile()).toBe('unknown');
    expect((await detectCapabilities()).renderer).toBe('none');
  });
  it('reads browser host features and releases renderer probe resources', async () => {
    const loseContext = vi.fn(); const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) }));
    vi.stubGlobal('navigator', { userAgent: 'Safari AppleWebKit', platform: 'iPad', maxTouchPoints: 5, deviceMemory: 4, standalone: true, serviceWorker: {}, xr: {}, gpu: { requestAdapter: async () => ({}) }, storage: { persisted: async () => true } });
    vi.stubGlobal('document', { createElement: () => ({ getContext }) }); vi.stubGlobal('indexedDB', new IDBFactory());
    const env = hostEnvironment(); expect(env.hasDOM).toBe(true); expect(env.runtime).toBe('node');
    expect(await detectRenderer(env)).toBe('webgpu'); expect(env.webgl?.()).toBe(true); expect(loseContext).toHaveBeenCalledOnce();
    expect((await detectStorage(env)).persistentStorage).toBe(true);
    getContext.mockReturnValueOnce(null as unknown as ReturnType<typeof getContext>).mockReturnValueOnce(null as unknown as ReturnType<typeof getContext>);
    expect(env.webgl?.()).toBe(false);
  });
  it('detects browser, worker, bun, deno, and unknown hosts without Node globals', () => {
    vi.stubGlobal('process', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('document', {}); vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(hostEnvironment()).toMatchObject({ runtime: 'browser', standalone: true });
    vi.stubGlobal('document', undefined); vi.stubGlobal('WorkerGlobalScope', {}); expect(hostEnvironment().runtime).toBe('worker');
    vi.stubGlobal('WorkerGlobalScope', undefined); expect(hostEnvironment().runtime).toBe('unknown');
    vi.stubGlobal('Deno', {}); expect(hostEnvironment().runtime).toBe('deno');
    vi.stubGlobal('process', { versions: { bun: '1' } }); expect(hostEnvironment().runtime).toBe('bun');
  });
});
describe('platform adapter contracts', () => {
  it.each([
    ['web', createWebAdapter], ['android', createAndroidAdapter], ['ios', createIosAdapter], ['desktop', createDesktopAdapter], ['xr', createXrAdapter]
  ] as const)('implements all six adapter interfaces for %s', async (platform, create) => {
    const adapter = await create({ environment: { wasm: true, deviceMemory: 8, runtime: 'native' } });
    expect(adapter.platform).toBe(platform); expect(adapter.capabilities.platform).toBe(platform); expect(Object.isFrozen(adapter.capabilities)).toBe(true);
    expect(adapter.policy).toMatchObject({ preferredExecution: 'wasm', memorySafeRendering: platform === 'ios', imageProxyMode: platform === 'ios', storageRecovery: true, offlineRecovery: true });
    await adapter.storage.set('key', 1); expect(await adapter.storage.get('key')).toBe(1);
    expect(await adapter.notifications.notify('title', 'body')).toMatchObject({ supported: false }); expect(await adapter.purchases.purchase('sku')).toMatchObject({ supported: false });
    expect(await adapter.device.info()).toEqual({ supported: true, value: { platform, runtime: 'native' } }); await adapter.telemetry.capture({ name: 'boot', category: 'runtime', timestamp: 0, attributes: {} });
  });
  it('uses injected host bridges and selects IndexedDB when available', async () => {
    const options = { environment: {}, storage: new MemoryStorage(), telemetry: { capture: vi.fn() }, notifications: { notify: vi.fn(async () => ({ supported: true as const, value: undefined })) }, purchases: { purchase: vi.fn(async () => ({ supported: true as const, value: { receipt: 'synthetic' } })) }, device: { info: vi.fn(async () => ({ supported: true as const, value: {} })) } };
    const adapter = await createPlatformAdapter('android', options); expect(adapter.storage).toBe(options.storage); expect(adapter.telemetry).toBe(options.telemetry);
    expect((await adapter.notifications.notify('a', 'b')).supported).toBe(true); expect((await adapter.purchases.purchase('sku')).supported).toBe(true); expect((await adapter.device.info()).supported).toBe(true);
    expect(adapter.policy).toMatchObject({ preferredExecution: 'javascript', memorySafeRendering: true });
    const browser = await createWebAdapter({ environment: { indexedDB: new IDBFactory() } }); expect(browser.storage).toBeInstanceOf(IndexedDBStorage); await (browser.storage as IndexedDBStorage).close();
    expect((await createWebAdapter()).platform).toBe('web'); expect((await createAndroidAdapter()).platform).toBe('android'); expect((await createIosAdapter()).platform).toBe('ios'); expect((await createDesktopAdapter()).platform).toBe('desktop'); expect((await createXrAdapter()).platform).toBe('xr');
    expect((await (await createPlatformAdapter('unknown', { environment: {} })).device.info())).toMatchObject({ supported: true, value: { runtime: 'unknown' } });
  });
});
function xrFixture() {
  let input: ((input: JsonObject) => void) | undefined; let ended: (() => void) | undefined;
  const offInput = vi.fn(); const offEnd = vi.fn();
  const session: XRSessionBridge = { end: vi.fn(async () => undefined), onInput: fn => { input = fn; return offInput; }, onEnd: fn => { ended = fn; return offEnd; } };
  const bridge: XRBridge = { runtime: 'openxr', supported: async () => true, request: async () => session };
  const events = new EventBus<XREvents>(); const onError = vi.fn();
  const shared = { state: new State({ n: 0 }), events, simulation: new Simulation(0 as number, { seed: 1, stepMs: 1, parameters: {} }, n => n), onError };
  return { session, bridge, shared, input: (data: JsonObject) => input?.(data), ended: () => ended?.(), offInput, offEnd };
}
describe('XR integration', () => {
  it('shares the host engines and translates session input without advancing simulation', async () => {
    const fixture = xrFixture(); const xr = new XRIntegration(fixture.bridge, fixture.shared); const handler = vi.fn(); fixture.shared.events.subscribe('xr.input', handler);
    expect(xr.shared.state).toBe(fixture.shared.state); expect(xr.active).toBe(false); expect(await xr.start('immersive-vr')).toEqual({ supported: true, value: undefined });
    fixture.input({ action: 'select' }); await Promise.resolve(); expect(handler).toHaveBeenCalledWith({ action: 'select' }); expect(fixture.shared.simulation.status).toBe('idle');
    expect((await xr.start('inline')).supported).toBe(false); await xr.stop(); expect(fixture.session.end).toHaveBeenCalledOnce(); expect(fixture.offInput).toHaveBeenCalledOnce(); expect(fixture.offEnd).toHaveBeenCalledOnce(); expect(xr.active).toBe(false); await xr.stop();
  });
  it('releases ownership when the host ends a session', async () => {
    const fixture = xrFixture(); const xr = new XRIntegration(fixture.bridge, fixture.shared); await xr.start('immersive-ar'); fixture.ended(); expect(xr.active).toBe(false); expect(fixture.offInput).toHaveBeenCalledOnce(); await xr.stop();
  });
  it('degrades when sessions or capabilities fail', async () => {
    const fixture = xrFixture(); fixture.bridge.supported = async () => false;
    const xr = new XRIntegration(fixture.bridge, fixture.shared); expect((await xr.start('inline')).supported).toBe(false);
    fixture.bridge.supported = async () => { throw new Error('denied'); }; expect(await xr.start('inline')).toMatchObject({ supported: false, reason: 'denied' });
    fixture.bridge.supported = async () => true; fixture.bridge.request = async () => { throw 'unavailable'; }; expect(await xr.start('inline')).toMatchObject({ reason: 'unavailable' });
  });
  it('cleans partially initialized sessions and reports cleanup failures', async () => {
    const fixture = xrFixture(); fixture.session.onInput = () => { throw new Error('input'); }; fixture.session.end = async () => { throw new Error('end'); };
    const xr = new XRIntegration(fixture.bridge, fixture.shared); expect((await xr.start('inline')).supported).toBe(false); expect(fixture.shared.onError).toHaveBeenCalledOnce(); expect(xr.active).toBe(false);
  });
  it('cleans up after onEnd registration fails', async () => {
    const fixture = xrFixture(); fixture.session.onEnd = () => { throw new Error('listener'); }; const xr = new XRIntegration(fixture.bridge, fixture.shared);
    expect((await xr.start('inline')).supported).toBe(false); expect(fixture.offInput).toHaveBeenCalledOnce(); expect(fixture.session.end).toHaveBeenCalledOnce();
  });
  it('reports asynchronous event delivery errors and contains diagnostic sink errors', async () => {
    const fixture = xrFixture(); fixture.shared.events.subscribe('xr.input', () => { throw new Error('handler'); }); fixture.shared.onError.mockImplementation(() => { throw new Error('diagnostics'); });
    const xr = new XRIntegration(fixture.bridge, fixture.shared); await xr.start('inline'); fixture.input({ action: 'select' });
    await vi.waitFor(() => expect(fixture.shared.onError).toHaveBeenCalledOnce()); await xr.stop();
  });
  it('guards transitions and releases ownership even when session shutdown fails', async () => {
    const fixture = xrFixture(); let release!: () => void; fixture.bridge.supported = () => new Promise(resolve => { release = () => resolve(true); });
    const xr = new XRIntegration(fixture.bridge, fixture.shared); const first = xr.start('inline'); expect((await xr.start('inline')).supported).toBe(false); await expect(xr.stop()).rejects.toThrow('transition'); release(); await first;
    fixture.session.end = async () => { throw new Error('end'); }; await expect(xr.stop()).rejects.toThrow('end'); expect(xr.active).toBe(false);
  });
});
describe('WebXR bridge', () => {
  it('translates WebXR events into portable input and removes all listeners', async () => {
    const listeners = new Map<string, (event: WebXRInputEvent) => void>();
    const session: WebXRSession = { end: vi.fn(async () => undefined), addEventListener: (type, listener) => { listeners.set(type, listener); }, removeEventListener: (type) => { listeners.delete(type); } };
    const system: WebXRSystem = { isSessionSupported: async () => true, requestSession: async () => session };
    const bridge = new WebXRBridge(system); expect(bridge.runtime).toBe('webxr'); expect(await bridge.supported('inline')).toBe(true);
    const translated = await bridge.request('inline'); const inputs = vi.fn(); const offInput = translated.onInput(inputs); const ended = vi.fn(); const offEnd = translated.onEnd(ended);
    listeners.get('select')?.({ type: 'select', inputSource: { handedness: 'left', targetRayMode: 'tracked-pointer' } }); listeners.get('squeeze')?.({ type: 'squeeze' }); listeners.get('end')?.({ type: 'end' });
    expect(inputs.mock.calls).toEqual([[{ type: 'select', handedness: 'left', targetRayMode: 'tracked-pointer' }], [{ type: 'squeeze' }]]); expect(ended).toHaveBeenCalledOnce();
    offInput(); offEnd(); expect(listeners.size).toBe(0); await translated.end(); expect(session.end).toHaveBeenCalledOnce();
  });
  it('handles unsupported hosts and rejected capability checks', async () => {
    const bridge = new WebXRBridge(); expect(await bridge.supported('inline')).toBe(false); await expect(bridge.request('inline')).rejects.toThrow('unavailable');
    expect(await new WebXRBridge({ isSessionSupported: async () => { throw new Error(); }, requestSession: async () => { throw new Error(); } }).supported('inline')).toBe(false);
    vi.stubGlobal('navigator', { xr: { isSessionSupported: async () => true } }); expect(await new WebXRBridge().supported('inline')).toBe(true);
  });
});

it('reports listener cleanup failures while releasing all XR resources', async () => {
  const fixture = xrFixture(); fixture.offInput.mockImplementation(() => { throw new Error('unsubscribe'); });
  const xr = new XRIntegration(fixture.bridge, fixture.shared);
  await xr.start('inline'); fixture.ended(); expect(xr.active).toBe(false); expect(fixture.offEnd).toHaveBeenCalledOnce(); expect(fixture.shared.onError).toHaveBeenCalledOnce();
  await xr.start('inline'); await xr.stop(); expect(fixture.session.end).toHaveBeenCalledOnce();
});

it('contains synchronous errors from an injected XR event bus', async () => {
  const fixture = xrFixture(); fixture.shared.events.emit = () => { throw new Error('custom bus'); };
  const xr = new XRIntegration(fixture.bridge, fixture.shared); await xr.start('inline');
  expect(() => fixture.input({ action: 'select' })).not.toThrow(); expect(fixture.shared.onError).toHaveBeenCalledOnce(); await xr.stop();
});
