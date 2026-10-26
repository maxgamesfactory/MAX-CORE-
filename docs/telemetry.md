# Telemetry

## Architecture and responsibilities

`Telemetry` copies and freezes portable events and forwards them to an injected
`TelemetryContract` sink. It owns no exporter, network dependency or Portal-OS
integration. Categories are performance, runtime, storage and diagnostic.

## Public APIs and example

```ts
const telemetry = new Telemetry({ capture: async event => console.log(event) },
  () => performance.now());
await telemetry.record('frame.duration', 'performance', { milliseconds: 12 });
await telemetry.capture({ name: 'boot', category: 'runtime', timestamp: 0,
  attributes: { platform: 'web' } });
```

`record(name, category, attributes = {})` uses the injected clock (Date.now by
default). `capture(event)` uses the supplied timestamp. Platform adapters accept a
sink and otherwise use an intentional no-op sink. Engines do not automatically
collect data or add hidden telemetry side effects.

## Failure modes and recovery

Empty names, nonfinite timestamps and non-JSON attributes reject. Sink errors
propagate. Callers choose retry/buffering/drop policies and should avoid routing a
sink error recursively through the same sink. Repair or replace the host sink;
there is no hidden upload queue or retry. Keep personal data out of diagnostics.
