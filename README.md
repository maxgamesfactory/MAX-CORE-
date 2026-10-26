# MAX-CORE

The portable TypeScript foundation for the MAX ecosystem. Products consume core;
core has **zero runtime dependencies** and never imports products or UI frameworks.

**Build once. Deploy everywhere. Simulate everywhere. Scale everywhere.**

## Develop

Node 22 (22.13+), 24, or 26+ and npm are required for development. Browser and native consumers need
an ES2022 JavaScript host (or a compatible bundler) and the appropriate host bridges.

```sh
npm ci --ignore-scripts
npm run check
npm run preview   # after build: browser checks at http://localhost:3100
```

`check` runs type checking, the architecture gate, coverage, and the declaration/ESM
build. CI checks Node 22 and 24 and audits dependencies. There is no application
server or framework to install. The package is private while its API is at 0.1.0.

## Use

```ts
import { State, EventBus, Simulation, Kernel } from '@max-ecosystem/core';

const state = new State({ ticks: 0 });
const events = new EventBus<{ tick: number }>();
const unsubscribe = events.subscribe('tick', ticks => state.patch({ ticks }));
const simulation = new Simulation<number, {}>(
  0, { seed: 42, stepMs: 16, parameters: {} }, current => current + 1
);
const kernel = new Kernel();
kernel.register('simulation', {
  start: () => simulation.start(), stop: () => simulation.stop()
});
await kernel.start();
simulation.update(10);
await events.emit('tick', simulation.get());
console.log(state.get()); // { ticks: 10 }
unsubscribe();
await kernel.stop();
```

Consumers can import types separately from `@max-ecosystem/core/contracts`.
`State`, `EventBus`, and `Simulation` are instantiated APIs; share instances through
one kernel or through explicit injection. There are no ambient global singletons.

## Subsystems

| Directory | Responsibility | Guide |
| --- | --- | --- |
| `contracts/` | Public interfaces and portable data types | [Contracts](docs/contracts.md) |
| `state/` | Immutable, observable state | [State](docs/state.md) |
| `events/` | Typed asynchronous event routing and retries | [Events](docs/events.md) |
| `simulation/` | Seeded fixed-step deterministic simulation and replay | [Simulation](docs/simulation.md) |
| `runtime/` | Kernel, scheduler, lifecycle, services, processes, telemetry | [Runtime](docs/runtime.md), [Telemetry](docs/telemetry.md) |
| `storage/` | IndexedDB, queue, Durable Object/D1 drivers and synchronization | [Storage and sync](docs/storage.md) |
| `adapters/` | Web, Android, iOS, desktop, XR translation and detection | [Adapters](docs/adapters.md), [XR](docs/xr.md) |
| `intelligence/` | Reserved boundary; no product agents | [Intelligence](docs/intelligence.md) |

See [architecture and repository rules](docs/architecture.md) and
[verification](docs/testing.md).

## Platform support boundary

The engines are shared across web, Android, iOS, desktop and XR JavaScript hosts.
Browser storage and WebXR have implementations. Native notifications, purchases,
device features and OpenXR/Quest/visionOS sessions require host-provided bridges.
No native SDKs, cloud resources, purchase flows or deployment credentials are
bundled. Unavailable renderer probes fall through to WebGL, DOM or `none`;
unavailable native features return explicit unsupported outcomes.
