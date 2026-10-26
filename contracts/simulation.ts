import type { Immutable, JsonObject, JsonValue } from './common.js';
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'stopped';
export interface SimulationConfig<C extends JsonObject> { seed: number; stepMs: number; parameters: C }
export interface SimulationFrame<C extends JsonObject> {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly config: Immutable<C>;
  readonly random: () => number;
}
export type SimulationReducer<S extends JsonValue, C extends JsonObject> = (state: Immutable<S>, frame: SimulationFrame<C>) => S;
export interface SimulationContract<S extends JsonValue> {
  readonly status: SimulationStatus;
  readonly tick: number;
  get(): Immutable<S>;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  update(steps?: number): void;
}
