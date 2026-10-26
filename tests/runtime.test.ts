import { describe, expect, it, vi } from 'vitest';
import { Kernel, ProcessManager, Scheduler, ServiceRegistry, Telemetry } from '../index.js';
import type { ExecutionContext, TelemetryEvent } from '../index.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
describe('runtime service registry', () => {
  it('registers, replaces, resolves and returns independent entry lists', () => {
    const registry = new ServiceRegistry(); registry.register('value', 1);
    expect(registry.resolve('value')).toBe(1); expect(() => registry.register('value', 2)).toThrow();
    expect(() => registry.register('', 1)).toThrow(); expect(() => registry.resolve('missing')).toThrow(); expect(() => registry.replace('missing', 1)).toThrow();
    registry.replace('value', 2); expect(registry.entries()).toEqual([['value', 2]]); registry.entries().pop(); expect(registry.resolve('value')).toBe(2);
  });
});
describe('Scheduler', () => {
  it('drains FIFO including tasks enqueued during a drain and can clear', async () => {
    const scheduler = new Scheduler(); const order: number[] = [];
    scheduler.enqueue(() => { order.push(1); scheduler.enqueue(() => { order.push(3); }); }); scheduler.enqueue(async () => { order.push(2); });
    expect(scheduler.pending).toBe(2); await scheduler.drain(); expect(order).toEqual([1, 2, 3]);
    scheduler.enqueue(() => undefined); scheduler.clear(); expect(scheduler.pending).toBe(0); await scheduler.drain();
  });
  it('rejects concurrent drain and preserves unexecuted tasks after failure', async () => {
    const scheduler = new Scheduler(); const gate = deferred<void>(); scheduler.enqueue(() => gate.promise);
    const first = scheduler.drain(); await expect(scheduler.drain()).rejects.toThrow('already'); gate.resolve(); await first;
    scheduler.enqueue(() => { throw new Error('task'); }); scheduler.enqueue(() => undefined);
    await expect(scheduler.drain()).rejects.toThrow('task'); expect(scheduler.pending).toBe(1); await scheduler.drain();
  });
});
describe('ProcessManager', () => {
  const context = (signal: AbortSignal): ExecutionContext => ({ signal, now: () => 10, resolve: <T>() => 1 as T });
  it('returns results, guards IDs and allows reuse after completion or rejection', async () => {
    const manager = new ProcessManager(context); const p = manager.spawn('a', async ctx => ctx.now());
    expect(manager.size).toBe(1); expect(p.id).toBe('a'); expect(() => manager.spawn('a', async () => 2)).toThrow(); expect(() => manager.spawn('', async () => 2)).toThrow();
    await expect(p.result).resolves.toBe(10); expect(manager.size).toBe(0);
    await expect(manager.spawn('a', async () => { throw new Error('task'); }).result).rejects.toThrow('task'); expect(manager.size).toBe(0);
    await manager.stop();
  });
  it('cancels cooperatively and waits for pending processes', async () => {
    const manager = new ProcessManager(context); const gate = deferred<void>();
    const p = manager.spawn('a', async ctx => { await gate.promise; return ctx.signal.aborted; });
    p.cancel(); const stopped = manager.stop(); gate.resolve(); await stopped; await expect(p.result).resolves.toBe(true); expect(manager.size).toBe(0);
  });
});
describe('Kernel', () => {
  it('starts in registration order and shuts down in reverse, with shared execution context', async () => {
    const order: string[] = []; const kernel = new Kernel(() => 12); let context!: ExecutionContext;
    expect(kernel.status).toBe('idle'); expect(() => kernel.spawn('x', async () => 1)).toThrow();
    const first = { start: (ctx: ExecutionContext) => { context = ctx; order.push('start1'); }, stop: () => { order.push('stop1'); } };
    kernel.register('first', {}); kernel.replace('first', first); kernel.register('second', { start: () => { order.push('start2'); }, stop: () => { order.push('stop2'); } });
    kernel.register('passive', {}); expect(kernel.resolve('first')).toBe(first);
    await kernel.start(); expect(kernel.status).toBe('running'); expect(context.now()).toBe(12); expect(context.resolve('first')).toBe(first);
    expect(() => kernel.register('late', {})).toThrow(); expect(() => kernel.replace('first', {})).toThrow(); await expect(kernel.start()).rejects.toThrow();
    expect(await kernel.spawn('x', async ctx => ctx.resolve('first')).result).toBe(first);
    kernel.scheduler.enqueue(() => undefined); await kernel.stop(); expect(context.signal.aborted).toBe(true); expect(kernel.scheduler.pending).toBe(0);
    expect(order).toEqual(['start1', 'start2', 'stop2', 'stop1']); expect(kernel.status).toBe('stopped'); await kernel.stop();
    await kernel.start(); await kernel.stop();
  });
  it('rolls back partially started services and aggregates cleanup errors', async () => {
    const kernel = new Kernel(); const stop = vi.fn();
    kernel.register('a', { stop }); kernel.register('b', { start: () => { throw new Error('startup'); }, stop: () => { throw new Error('cleanup'); } });
    await expect(kernel.start()).rejects.toMatchObject({ errors: [expect.any(Error), expect.any(Error)] }); expect(stop).toHaveBeenCalledOnce(); expect(kernel.status).toBe('stopped');
  });
  it('continues shutdown on failures and rejects overlapping lifecycle operations', async () => {
    const gate = deferred<void>(); const kernel = new Kernel();
    kernel.register('a', { start: () => gate.promise, stop: () => { throw new Error('shutdown'); } });
    const start = kernel.start(); expect(kernel.status).toBe('starting'); await expect(kernel.stop()).rejects.toThrow('transition'); gate.resolve(); await start;
    const work = deferred<void>(); const p = kernel.spawn('p', async ctx => { await work.promise; return ctx.signal.aborted; });
    const stop = kernel.stop(); expect(kernel.status).toBe('stopping'); await expect(kernel.stop()).rejects.toThrow('transition');
    work.resolve(); await expect(stop).rejects.toThrow('shutdown'); expect(await p.result).toBe(true); expect(kernel.status).toBe('stopped');
  });
  it('provides a default wall clock only in the execution context', async () => {
    const kernel = new Kernel(); await kernel.start(); const time = await kernel.spawn('time', async ctx => ctx.now()).result; expect(time).toBeGreaterThan(0); await kernel.stop();
  });
});
describe('Telemetry', () => {
  it('captures portable immutable events with injected and default clocks', async () => {
    const events: TelemetryEvent[] = []; const telemetry = new Telemetry({ capture: event => { events.push(event); } }, () => 100);
    await telemetry.record('frame', 'performance', { ms: 2 }); expect(events[0]).toEqual({ name: 'frame', category: 'performance', attributes: { ms: 2 }, timestamp: 100 });
    expect(Object.isFrozen(events[0]?.attributes)).toBe(true); await telemetry.record('boot', 'runtime');
    await new Telemetry({ capture: event => { expect(event.timestamp).toBeGreaterThan(0); } }).record('boot', 'runtime');
  });
  it('rejects invalid data and propagates sink failures', async () => {
    const telemetry = new Telemetry({ capture: () => { throw new Error('sink'); } });
    await expect(telemetry.capture({ name: '', category: 'diagnostic', timestamp: 1, attributes: {} })).rejects.toThrow('Invalid');
    await expect(telemetry.capture({ name: 'x', category: 'storage', timestamp: Infinity, attributes: {} })).rejects.toThrow('Invalid');
    await expect(telemetry.record('x', 'storage')).rejects.toThrow('sink');
  });
});
it('prevents new processes and overlapping shutdown during process manager stop', async () => {
  const manager = new ProcessManager(signal => ({ signal, now: () => 0, resolve: <T>() => undefined as T }));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const process = manager.spawn('x', async () => gate); const stop = manager.stop();
  expect(() => manager.spawn('late', async () => 1)).toThrow('stopping'); await expect(manager.stop()).rejects.toThrow('stopping');
  release(); await process.result; await stop; expect(manager.size).toBe(0);
});
