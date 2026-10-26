# MAX-CORE

A platform-neutral TypeScript foundation for state, events, deterministic
simulation, runtime services, adapters, and offline storage. No production
packages, framework imports, product logic, or browser work at module import.

## Develop

Node 22.13+ (Node 24 recommended; tests use `node:sqlite`), npm 11:

```sh
npm ci
npm test          # build, strict type contracts, behavior and integration tests
npm run example   # simulation + runtime + state + events
npm run build     # JavaScript, declarations, source maps in dist/
```

The package is ESM. Consumers import `@max/core`. Cloudflare integration helpers
are separately exported from `@max/core/storage/server`. Native hosts need an ESM
bundler/runtime; there are no Node imports in production source.

```ts
import { State, EventBus, Simulation } from '@max/core';

const state = new State({ count: 0 });
const events = new EventBus<{ changed: { count: number } }>();
const unsubscribe = state.subscribe(next => events.emit('changed', { count: next.count }));
await state.patch({ count: 1 });
unsubscribe();

const simulation = new Simulation({
  initial: { distance: 0 }, stepMs: 16, seed: 42,
  reduce: (current, { stepMs }) => ({ distance: current.distance + stepMs / 1000 }),
});
simulation.start();
simulation.update();
```

## Modules and guides

| Module | Responsibility | Guide |
| --- | --- | --- |
| `contracts/` | Typed boundaries and portable JSON payloads | [Architecture](docs/Architecture.md) |
| `state/` | Immutable snapshots, subscriptions, persistence | [Architecture](docs/Architecture.md#state) |
| `events/` | Typed synchronous communication | [Architecture](docs/Architecture.md#events) |
| `simulation/` | Fixed-step, seeded replay | [Simulation](docs/Simulation.md) |
| `runtime/` | Kernel, services, processes, scheduler, detection | [Runtime](docs/Runtime.md) |
| `storage/` | IndexedDB, atomic outbox, sync, D1/DO integration | [Storage](docs/Storage.md) |
| `adapters/` | Web, iOS, Android, desktop host bridges | [Adapters](docs/Adapters.md) |
| `intelligence/` | Reserved extension boundary | [Boundary](intelligence/README.md) |

## Integration status

The core and all four adapter factories are implemented and tested. Native
storage, notifications, purchases, and telemetry require host-provided bridges.
Unsupported capabilities reject explicitly. Cloudflare helpers require schema
installation, authenticated Worker routing, Durable Object and D1 bindings.
Local tests exercise SQL on SQLite and IndexedDB on fake-indexeddb; actual native
SDKs, Safari/WebKit, and deployed Cloudflare services have not been exercised.

Acknowledged data can be recovered after local storage loss. Unsynced data whose
only local copy is deleted cannot be recovered. See the storage guide for the
single-writer rule, bounded snapshot protocol, and deployment requirements.
