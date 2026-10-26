# Verification

## Commands

```sh
npm ci --ignore-scripts
npm run typecheck
npm run check:architecture
npm run test:coverage
npm run build
npm audit --audit-level=moderate
```

`npm run check` combines typecheck, architecture, coverage and build. Tests cover
all public value exports, assignability to required contracts, negative typing,
engine lifecycle/error behavior, SQL parameters, real IndexedDB behavior through
fake-indexeddb, durable-binding translation, offline sync/recovery and composed
runtime integration. D1 SQL is exercised using Node's in-memory SQLite engine.
There are no real cloud requests or provider credentials in these tests.

## Gates

State, events, simulation, runtime and storage must each reach 95% statements,
branches, functions and lines. General systems require 80% of each metric.
The checked-in Vitest configuration enforces these thresholds. Adding tests that
only repeat implementation is insufficient: cover contracts, observable behavior
and failure/recovery boundaries. Every public value export has exercised behavior;
public types have compile-time contract checks. CI runs on Node 22 and 24.

## Real browser checks

Build, then `npm run preview`. Open http://localhost:3100. The verification page
imports the built ESM library directly, without a bundler or framework. It checks
immutable state, async events, deterministic replay, kernel shutdown, real
IndexedDB rehydration, offline queue convergence, capability detection, and
unsupported XR fallback. It reports PASS/FAIL visibly and as `window.maxCoreResult`.
The preview serves only this harness and built library files.

## Limits and recovery

Browser storage tests cannot prove Safari eviction behavior or real hardware GPU
availability. Native stores, device notifications, purchases, entitlements, native
XR and deployed Cloudflare resources require host integration tests. Fixtures
verify structural contracts and SQL, not cloud permissions or distributed locks.
If a gate fails, preserve its output, repair the behavior/test gap and rerun affected
checks. Do not lower thresholds or weaken architecture contracts to pass CI.
