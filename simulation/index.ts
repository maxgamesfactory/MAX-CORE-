import type { DeepReadonly, JsonValue, SimulationContract, SimulationStatus } from '../contracts/index.js';
import { snapshot } from '../contracts/value.js';

export interface SimulationConfig<S extends JsonValue> {
  initial: S;
  stepMs: number;
  seed: number;
  reduce(state: DeepReadonly<S>, context: { tick: number; elapsedMs: number; stepMs: number; random(): number }): S;
}
/** Pure reducers plus a fixed step and seeded random stream enable replay. */
export class Simulation<S extends JsonValue> implements SimulationContract<S> {
  private state: DeepReadonly<S>;
  private initial: DeepReadonly<S>;
  private currentStatus: SimulationStatus = 'stopped';
  private currentTick = 0;
  private randomState: number;
  private readonly config: SimulationConfig<S>;
  constructor(config: SimulationConfig<S>) {
    if (!Number.isFinite(config.stepMs) || config.stepMs <= 0 || !Number.isInteger(config.seed)) throw new RangeError('Invalid simulation configuration');
    this.config = { ...config };
    this.initial = snapshot(config.initial);
    this.state = this.initial;
    this.randomState = config.seed >>> 0;
  }
  get status(): SimulationStatus { return this.currentStatus; }
  get tick(): number { return this.currentTick; }
  get(): DeepReadonly<S> { return this.state; }
  start(): void {
    if (this.status !== 'stopped') throw new Error('Simulation already started');
    this.state = this.initial;
    this.currentTick = 0;
    this.randomState = this.config.seed >>> 0;
    this.currentStatus = 'running';
  }
  pause(): void { if (this.status === 'running') this.currentStatus = 'paused'; }
  resume(): void { if (this.status === 'paused') this.currentStatus = 'running'; }
  stop(): void { this.currentStatus = 'stopped'; }
  update(): DeepReadonly<S> {
    if (this.status !== 'running') return this.state;
    let randomState = this.randomState;
    const random = (): number => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 4294967296;
    };
    const tick = this.currentTick + 1;
    const next = snapshot(this.config.reduce(this.state, { tick, elapsedMs: tick * this.config.stepMs, stepMs: this.config.stepMs, random }));
    this.state = next;
    this.currentTick = tick;
    this.randomState = randomState;
    return next;
  }
}
