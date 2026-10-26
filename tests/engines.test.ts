import { describe, expect, it, vi } from 'vitest';
import { EventBus, Simulation, State } from '../index.js';
import { cloneJson, snapshot } from '../state/json.js';
import type { JsonValue } from '../index.js';

describe('JSON snapshots', () => {
  it('copies and freezes primitives, nested objects, and arrays including special keys', () => {
    const input = JSON.parse('{"__proto__":{"safe":true},"list":[1,"s",true,null]}') as JsonValue;
    const output = cloneJson(input);
    expect(output).toEqual(input); expect(output).not.toBe(input); expect(Object.isFrozen(output)).toBe(true);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(snapshot(Object.assign(Object.create(null) as object, { a: 1 }) as JsonValue)).toEqual({ a: 1 });
  });
  it.each([NaN, Infinity, undefined, () => 1, Symbol('x'), new Date(), [undefined], new Array(2)])('rejects non-JSON input %s', input => {
    expect(() => cloneJson(input as JsonValue)).toThrow(TypeError);
  });
  it('rejects cycles but accepts repeated references', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => cloneJson(cyclic as JsonValue)).toThrow(TypeError);
    const child = { n: 1 }; expect(cloneJson([child, child])).toEqual([{ n: 1 }, { n: 1 }]);
  });
});
describe('State', () => {
  it('publishes immutable updates with previous state and shallow patches', () => {
    const input = { n: 0, nested: { a: 1 } };
    const state = new State(input); const listener = vi.fn();
    const off = state.subscribe(listener); state.subscribe(listener);
    input.nested.a = 99;
    expect(state.get().nested.a).toBe(1);
    expect(() => { (state.get().nested as { a: number }).a = 2; }).toThrow();
    state.patch({ nested: { a: 3 } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ n: 0, nested: { a: 3 } }, { n: 0, nested: { a: 1 } });
    off(); off(); state.set({ n: 7, nested: { a: 4 } });
    expect(listener).toHaveBeenCalledTimes(1); expect(state.get().n).toBe(7);
  });
  it('delivers a stable subscription snapshot and aggregates observer failures after committing', () => {
    const state = new State({ n: 0 }); const last = vi.fn(); const added = vi.fn();
    state.subscribe(() => { state.unsubscribe(last); state.subscribe(added); throw new Error('observer'); });
    state.subscribe(() => state.patch({ n: 100 })); state.subscribe(last);
    expect(() => state.set({ n: 1 })).toThrow(AggregateError);
    expect(last).toHaveBeenCalledTimes(1); expect(added).not.toHaveBeenCalled(); expect(state.get().n).toBe(1);
    expect(() => state.patch({ n: 2 })).toThrow(AggregateError); expect(added).toHaveBeenCalledTimes(1);
  });
  it('leaves state intact when validation fails', () => {
    const state = new State({ n: 0 }); expect(() => state.patch({ n: NaN })).toThrow(); expect(state.get().n).toBe(0);
  });
});
describe('EventBus', () => {
  it('routes typed asynchronous events and removes subscriptions', async () => {
    const events = new EventBus<{ ping: { n: number }; other: null }>(); const delivered: number[] = [];
    const handler = vi.fn(async (data: { readonly n: number }) => { await Promise.resolve(); delivered.push(data.n); });
    const off = events.subscribe('ping', handler); events.subscribe('ping', handler);
    await events.emit('other', null); await events.emit('ping', { n: 4 });
    expect(delivered).toEqual([4]); off(); off(); events.unsubscribe('other', () => undefined);
    await events.emit('ping', { n: 5 }); expect(handler).toHaveBeenCalledTimes(1);
  });
  it('retries only failed subscribers and snapshots payloads before async work', async () => {
    const wait = vi.fn(async () => undefined); const bus = new EventBus<{ ping: { n: number } }>(wait);
    const stable = vi.fn(); let calls = 0;
    bus.subscribe('ping', data => { expect(data.n).toBe(1); expect(Object.isFrozen(data)).toBe(true); if (++calls < 3) throw new Error('retry'); });
    bus.subscribe('ping', stable);
    const input = { n: 1 }; const delivery = bus.emit('ping', input, { retries: 2, delayMs: 1 }); input.n = 9;
    await delivery; expect(stable).toHaveBeenCalledTimes(1); expect(wait).toHaveBeenCalledTimes(2);
  });
  it('waits for all subscribers and aggregates failures without delay', async () => {
    const bus = new EventBus<{ ping: null }>(); const completed = vi.fn();
    bus.subscribe('ping', () => { throw new Error('fail'); }); bus.subscribe('ping', async () => { await Promise.resolve(); completed(); });
    await expect(bus.emit('ping', null, { retries: 1 })).rejects.toThrow(AggregateError); expect(completed).toHaveBeenCalledOnce();
  });
  it('uses the default retry timer when requested', async () => {
    const bus = new EventBus<{ ping: null }>(); const handler = vi.fn().mockRejectedValueOnce('temporary').mockResolvedValue(undefined);
    bus.subscribe('ping', handler); await bus.emit('ping', null, { retries: 1, delayMs: 1 }); expect(handler).toHaveBeenCalledTimes(2);
  });
  it.each([{ retries: -1 }, { retries: 1.1 }, { retries: Infinity }, { retries: 0, delayMs: -1 }, { retries: 0, delayMs: Infinity }])('rejects invalid retry policy %j', async policy => {
    await expect(new EventBus().emit('x', null, policy)).rejects.toThrow(RangeError);
  });
});
describe('Simulation', () => {
  const config = { seed: 42, stepMs: 10, parameters: { speed: 2 } };
  const reducer = (state: { readonly total: number }, frame: { readonly random: () => number; readonly config: { readonly speed: number } }) => ({ total: state.total + frame.random() * frame.config.speed });
  it('replays exactly across different update batching and restarts', () => {
    const sim = new Simulation({ total: 0 }, config, reducer);
    expect(sim.status).toBe('idle'); expect(sim.get()).toEqual({ total: 0 });
    sim.start(); sim.update(20); const expected = sim.get();
    expect(sim.tick).toBe(20); expect(sim.replay().get()).toEqual(expected);
    sim.stop(); sim.start(); for (let i = 0; i < 20; i++) sim.update();
    expect(sim.get()).toEqual(expected); sim.pause(); expect(sim.status).toBe('paused'); sim.resume(); expect(sim.status).toBe('running');
    expect(new Simulation(0 as number, config, () => 1).replay().tick).toBe(0);
  });
  it('supplies deterministic frame values and frozen config', () => {
    const update = vi.fn((state: number) => state + 1); const sim = new Simulation(0 as number, config, update);
    sim.start(); sim.update(); expect(update.mock.calls[0]?.[0]).toBe(0);
    const frame = (update.mock.calls as unknown as [number, { tick: number; elapsedMs: number; config: object }][])[0]![1];
    expect(frame.tick).toBe(1); expect(frame.elapsedMs).toBe(10); expect(Object.isFrozen(frame.config)).toBe(true);
  });
  it('rolls back random state and tick when the reducer fails', () => {
    const seen: number[] = []; let fail = true;
    const sim = new Simulation(0 as number, config, (_, frame) => { seen.push(frame.random()); if (fail) throw new Error('failed'); return 1; });
    sim.start(); expect(() => sim.update()).toThrow('failed'); expect(sim.tick).toBe(0); expect(sim.get()).toBe(0);
    fail = false; sim.update(); expect(seen[0]).toBe(seen[1]);
  });
  it('keeps the previous committed step when a later step produces invalid data', () => {
    const sim = new Simulation(0 as number, config, (_, frame) => frame.tick === 2 ? NaN : 1);
    sim.start(); expect(() => sim.update(2)).toThrow(); expect(sim.tick).toBe(1); expect(sim.get()).toBe(1);
  });
  it('guards all lifecycle transitions and invalid step counts', () => {
    const sim = new Simulation(0 as number, config, n => n + 1);
    expect(() => sim.update()).toThrow(); expect(() => sim.resume()).toThrow(); sim.start();
    expect(() => sim.start()).toThrow(); expect(() => sim.resume()).toThrow(); sim.pause(); expect(() => sim.start()).toThrow();
    expect(() => sim.update()).toThrow(); sim.resume();
    for (const steps of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => sim.update(steps)).toThrow(RangeError);
    sim.stop(); expect(() => sim.pause()).toThrow();
    const overflow = new Simulation(0 as number, { ...config, stepMs: Number.MAX_VALUE }, n => n); overflow.start(); expect(() => overflow.update(2)).toThrow(RangeError);
  });
  it.each([{ seed: -1, stepMs: 1 }, { seed: 1.2, stepMs: 1 }, { seed: 0x100000000, stepMs: 1 }, { seed: 1, stepMs: 0 }, { seed: 1, stepMs: Infinity }])('rejects invalid configuration %j', config => {
    expect(() => new Simulation(0 as number, { ...config, parameters: {} }, n => n)).toThrow(RangeError);
  });
});
