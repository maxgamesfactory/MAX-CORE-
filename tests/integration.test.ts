import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../index.js';
import type { EventContract, PlatformAdapter, RuntimeContract, SimulationContract, StateContract, StorageContract, TelemetryContract, XRContract } from '../index.js';

describe('public contracts', () => {
  it('exports an intentional API with no host side effects', () => {
    expect(Object.keys(core).sort()).toEqual([
      'State', 'EventBus', 'Simulation', 'Kernel', 'ServiceRegistry', 'Scheduler', 'ProcessManager', 'Telemetry',
      'MemoryStorage', 'IndexedDBStorage', 'DurableObjectStorage', 'D1Storage', 'SyncReplica', 'SyncAuthority', 'compareVersions',
      'createPlatformAdapter', 'createWebAdapter', 'createAndroidAdapter', 'createIosAdapter', 'createDesktopAdapter', 'createXrAdapter',
      'detectPlatform', 'detectBrowser', 'detectRenderer', 'detectCapabilities', 'detectStorage', 'detectMemoryProfile', 'detectRuntime', 'hostEnvironment',
      'XRIntegration', 'WebXRBridge'
    ].sort());
    expectTypeOf<core.State<{ n: number }>>().toExtend<StateContract<{ n: number }>>();
    expectTypeOf<core.EventBus<{ tick: number }>>().toExtend<EventContract<{ tick: number }>>();
    expectTypeOf<core.Simulation<number, {}>>().toExtend<SimulationContract<number>>();
    expectTypeOf<core.Kernel>().toExtend<RuntimeContract>(); expectTypeOf<core.MemoryStorage>().toExtend<StorageContract>();
    expectTypeOf<core.Telemetry>().toExtend<TelemetryContract>(); expectTypeOf<core.XRIntegration<{ n: number }, number>>().toExtend<XRContract>();
    expectTypeOf<Awaited<ReturnType<typeof core.createWebAdapter>>>().toExtend<PlatformAdapter>();
  });
  it('rejects mismatched payloads and mutation at compile time', () => {
    const events = new core.EventBus<{ tick: { n: number } }>(); const state = new core.State({ n: 0 });
    // Type-only negative cases, checked by tsc without executing invalid code.
    const typeChecks = () => {
      // @ts-expect-error unknown event name
      void events.emit('missing', { n: 1 });
      // @ts-expect-error wrong payload
      void events.emit('tick', { n: 'bad' });
      // @ts-expect-error state snapshots are immutable
      state.get().n = 2;
      // @ts-expect-error patches preserve field types
      state.patch({ n: 'bad' });
    };
    expect(typeChecks).toBeTypeOf('function');
  });
});
it('runs shared state, events, simulation, lifecycle, telemetry, and offline sync together', async () => {
  const local = new core.MemoryStorage(); const authority = new core.SyncAuthority(new core.MemoryStorage());
  const sync = new core.SyncReplica(local, authority, 'integration'); const state = new core.State({ ticks: 0 }); const events = new core.EventBus<{ tick: number }>();
  const telemetryEvents: core.TelemetryEvent[] = []; const telemetry = new core.Telemetry({ capture: event => { telemetryEvents.push(event); } }, () => 0);
  const adapter = await core.createWebAdapter({ environment: { hasDOM: true }, storage: local, telemetry });
  const sim = new core.Simulation(0 as number, { seed: 1, stepMs: 16, parameters: {} }, n => n + 1); const kernel = new core.Kernel(() => 0);
  const off = events.subscribe('tick', tick => state.patch({ ticks: tick }));
  kernel.register('storage', { start: () => sync.rehydrate() }); kernel.register('simulation', { start: () => sim.start(), stop: () => sim.stop() });
  await kernel.start(); kernel.scheduler.enqueue(async () => { sim.update(3); await events.emit('tick', sim.get()); }); await kernel.scheduler.drain();
  await sync.set('snapshot', state.get()); await sync.flush(); await adapter.telemetry.capture({ name: 'tick', category: 'runtime', timestamp: 0, attributes: { tick: sim.tick } });
  const recovered = new core.SyncReplica(local, authority, 'integration'); await recovered.rehydrate(); expect(await recovered.get('snapshot')).toEqual({ ticks: 3 });
  expect(sim.replay().get()).toBe(3); expect(state.get().ticks).toBe(3); expect(telemetryEvents).toHaveLength(1);
  off(); await kernel.stop(); expect(sim.status).toBe('stopped'); expect(kernel.status).toBe('stopped');
});
