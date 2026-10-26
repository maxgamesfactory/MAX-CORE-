import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State, EventBus, Simulation, MemoryStorage, Kernel, ProcessManager, Scheduler } from '../dist/index.js';

test('state clones/freezes input, serializes patches, persists and rehydrates', async () => {
  const storage = new MemoryStorage();
  const input = { count: 0, nested: { value: 1 } };
  const options = { storage, key: 'state', decode: value => {
    if (typeof value?.count !== 'number') throw new Error('Invalid state');
    return value;
  } };
  const state = new State(input, options);
  input.nested.value = 99;
  assert.equal(state.get().nested.value, 1);
  assert.throws(() => { state.get().nested.value = 2; }, TypeError);
  const changes = [];
  const listener = (next, previous) => changes.push([next.count, previous.count]);
  const unsubscribe = state.subscribe(listener);
  await Promise.all([state.patch({ count: 1 }), state.patch({ nested: { value: 3 } })]);
  assert.deepEqual(state.get(), { count: 1, nested: { value: 3 } });
  assert.deepEqual(changes, [[1, 0], [1, 1]]);
  unsubscribe();
  await state.set({ count: 2, nested: { value: 4 } });
  assert.equal(changes.length, 2);
  const restored = new State({ count: -1 }, options);
  assert.equal(await restored.rehydrate(), true);
  assert.equal(restored.get().count, 2);
  await storage.set('state', 'invalid');
  await assert.rejects(restored.rehydrate(), /Invalid state/);
  assert.equal(restored.get().count, 2);
});

test('persistence failure leaves state untouched and permits retry; observers all run', async () => {
  let fail = true;
  const storage = { get: async () => undefined, set: async () => { if (fail) throw new Error('disk full'); }, remove: async () => {} };
  const state = new State({ count: 0 }, { storage, key: 's', decode: v => v });
  let observed = 0;
  state.subscribe(() => { throw new Error('observer failed'); });
  state.subscribe(() => { observed++; });
  await assert.rejects(state.patch({ count: 1 }), /disk full/);
  assert.equal(state.get().count, 0);
  assert.equal(observed, 0);
  fail = false;
  await assert.rejects(state.patch({ count: 2 }), AggregateError);
  assert.equal(state.get().count, 2);
  assert.equal(observed, 1);
});

test('typed event bus routes globally, isolates payloads and snapshots listeners', () => {
  const bus = new EventBus();
  const results = [];
  const second = payload => results.push(payload.value);
  bus.subscribe('change', payload => { bus.unsubscribe('change', second); assert.throws(() => { payload.value = 9; }); });
  bus.subscribe('change', second);
  bus.subscribe('other', () => assert.fail('wrong route'));
  bus.emit('change', { value: 1 });
  bus.emit('change', { value: 2 });
  assert.deepEqual(results, [1]);
  bus.subscribe('error', () => { throw new Error('first'); });
  bus.subscribe('error', () => results.push('last'));
  assert.throws(() => bus.emit('error', null), AggregateError);
  assert.equal(results.at(-1), 'last');
});

test('simulation replay, pause, restart, and failed update rollback are deterministic', () => {
  let fail = false;
  const config = { initial: { total: 0 }, seed: 42, stepMs: 16, reduce: (state, context) => {
    const amount = context.random();
    if (fail) throw new Error('reducer');
    return { total: state.total + amount, elapsed: context.elapsedMs };
  } };
  const a = new Simulation(config), b = new Simulation(config);
  config.stepMs = 999;
  a.start(); b.start();
  for (let i = 0; i < 10; i++) { a.update(); b.update(); }
  assert.deepEqual(a.get(), b.get());
  assert.equal(a.get().elapsed, 160);
  a.pause(); a.update(); assert.equal(a.tick, 10);
  a.resume(); fail = true; assert.throws(() => a.update(), /reducer/); assert.equal(a.tick, 10);
  fail = false; a.update(); b.update(); assert.deepEqual(a.get(), b.get());
  a.stop(); a.start(); const first = a.update();
  b.stop(); b.start(); assert.deepEqual(first, b.update());
});

test('runtime boot rollback, shutdown retry and lifecycle serialization', async () => {
  const trace = [];
  let fails = true;
  const kernel = new Kernel();
  kernel.register('first', { start: () => trace.push('start1'), stop: () => trace.push('stop1') });
  kernel.register('second', { start: () => { trace.push('start2'); if (fails) throw new Error('boot'); }, stop: () => trace.push('stop2') });
  await assert.rejects(kernel.boot(), AggregateError);
  assert.deepEqual(trace, ['start1', 'start2', 'stop2', 'stop1']);
  assert.equal(kernel.status, 'stopped');
  fails = false;
  await Promise.all([kernel.boot(), kernel.boot()]);
  assert.equal(trace.filter(value => value === 'start1').length, 2);
  assert.equal(kernel.services.get('first') instanceof Object, true);
  assert.throws(() => kernel.register('late', {}), /sealed/);
  await kernel.shutdown();
  const retry = new Kernel();
  retry.register('service', { start() {}, stop() { if (!fails) { fails = true; throw new Error('stop'); } } });
  await retry.boot();
  await assert.rejects(retry.shutdown(), AggregateError);
  await assert.rejects(retry.boot(), /Shutdown must finish/);
  await retry.shutdown();
  await retry.boot();
  await retry.shutdown();
});

test('process manager controls independent processes', async () => {
  const manager = new ProcessManager();
  let active = 0;
  manager.register('worker', { start() { active++; }, stop() { active--; } });
  await manager.start('worker');
  assert.equal(manager.status('worker'), 'running');
  assert.equal(active, 1);
  await manager.stop();
  assert.equal(active, 0);
});

test('scheduler prevents overlap and cancels repeat after in-flight shutdown', async () => {
  const callbacks = new Map();
  let id = 0;
  const timer = { set: fn => { callbacks.set(++id, fn); return id; }, clear: id => callbacks.delete(id) };
  const scheduler = new Scheduler(error => assert.fail(error), timer);
  let release;
  let count = 0;
  scheduler.schedule(async () => { count++; await new Promise(resolve => { release = resolve; }); }, 10, true);
  const callback = callbacks.get(1); callbacks.delete(1); callback();
  await Promise.resolve();
  assert.equal(callbacks.size, 0);
  const stopping = scheduler.stop();
  release(); await stopping;
  assert.equal(count, 1); assert.equal(callbacks.size, 0);
  assert.throws(() => scheduler.schedule(() => {}, 10), /stopped/);
  scheduler.start();
  const cancel = scheduler.schedule(() => assert.fail(), 1);
  cancel(); assert.equal(callbacks.size, 0);
});

test('non-portable values are rejected at state boundary', () => {
  for (const value of [NaN, Infinity, undefined, new Date(), () => {}, [undefined]]) assert.throws(() => new State({ value }), TypeError);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => new State(cycle), TypeError);
});


test('process starts queued during stop cannot escape manager shutdown', async () => {
  const manager = new ProcessManager();
  let active = 0;
  manager.register('worker', { start() { active++; }, stop() { active--; } });
  await manager.start('worker');
  const stopping = manager.stop();
  const starting = manager.start('worker');
  await stopping;
  await assert.rejects(starting, /manager is stopped/);
  assert.equal(active, 0);
  await manager.start(); await manager.start('worker');
  assert.equal(active, 1);
  await manager.stop();
});
