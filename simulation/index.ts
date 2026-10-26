import type { Immutable, JsonObject, JsonValue, SimulationConfig, SimulationContract, SimulationReducer, SimulationStatus } from '../contracts/index.js';
import { snapshot } from '../state/json.js';

export class Simulation<S extends JsonValue, C extends JsonObject> implements SimulationContract<S> {
  private phase: SimulationStatus = 'idle';
  private current: Immutable<S>;
  private readonly initial: Immutable<S>;
  private readonly config: Immutable<SimulationConfig<C>>;
  private ticks = 0;
  private randomState: number;
  constructor(initial: S, config: SimulationConfig<C>, private readonly reducer: SimulationReducer<S, C>) {
    if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff || !Number.isFinite(config.stepMs) || config.stepMs <= 0) throw new RangeError('Invalid simulation configuration');
    this.initial = snapshot(initial);
    this.current = this.initial;
    this.config = snapshot({ ...config });
    this.randomState = config.seed;
  }
  get status(): SimulationStatus { return this.phase; }
  get tick(): number { return this.ticks; }
  get(): Immutable<S> { return this.current; }
  start(): void {
    if (this.phase === 'running' || this.phase === 'paused') throw new Error('Simulation already started');
    this.current = this.initial; this.ticks = 0; this.randomState = this.config.seed; this.phase = 'running';
  }
  pause(): void { this.require('running'); this.phase = 'paused'; }
  resume(): void { this.require('paused'); this.phase = 'running'; }
  stop(): void { this.phase = 'stopped'; }
  update(steps = 1): void {
    this.require('running');
    if (!Number.isSafeInteger(steps) || steps < 1 || !Number.isSafeInteger(this.ticks + steps) || !Number.isFinite((this.ticks + steps) * this.config.stepMs)) throw new RangeError('Invalid step count');
    for (let i = 0; i < steps; i++) {
      let randomState = this.randomState;
      const random = () => {
        randomState = (randomState + 0x6d2b79f5) >>> 0;
        let value = randomState;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
      const next = this.reducer(this.current, { tick: this.ticks + 1, elapsedMs: (this.ticks + 1) * this.config.stepMs, config: this.config.parameters, random });
      this.current = snapshot(next);
      this.randomState = randomState;
      this.ticks++;
    }
  }
  /** Replay from the original configuration with the same reducer and number of steps. */
  replay(steps = this.ticks): Simulation<S, C> {
    const result = new Simulation(this.initial as S, this.config as SimulationConfig<C>, this.reducer);
    result.start();
    if (steps !== 0) result.update(steps);
    return result;
  }
  private require(status: SimulationStatus): void {
    if (this.phase !== status) throw new Error(`Simulation must be ${status}`);
  }
}
