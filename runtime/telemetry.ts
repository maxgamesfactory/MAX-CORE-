import type { JsonObject, TelemetryContract, TelemetryEvent } from '../contracts/index.js';
import { cloneJson as snapshot } from '../state/json.js';

export class Telemetry implements TelemetryContract {
  constructor(private readonly sink: TelemetryContract, private readonly clock: () => number = () => Date.now()) {}
  async capture(event: TelemetryEvent): Promise<void> {
    if (!event.name || !Number.isFinite(event.timestamp)) throw new Error('Invalid telemetry event');
    await this.sink.capture(snapshot(event as unknown as JsonObject) as unknown as TelemetryEvent);
  }
  record(name: string, category: TelemetryEvent['category'], attributes: JsonObject = {}): Promise<void> {
    return this.capture({ name, category, attributes, timestamp: this.clock() });
  }
}
