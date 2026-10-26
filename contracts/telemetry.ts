import type { JsonObject } from './common.js';
export interface TelemetryEvent {
  name: string;
  category: 'performance' | 'runtime' | 'storage' | 'diagnostic';
  timestamp: number;
  attributes: JsonObject;
}
export interface TelemetryContract { capture(event: TelemetryEvent): void | Promise<void> }
