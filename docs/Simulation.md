# Simulation

```ts
import { Simulation } from '@max/core';
const simulation = new Simulation({
  initial: { position: 0 },
  seed: 42,
  stepMs: 16,
  reduce: (state, { stepMs, random }) => ({
    position: state.position + stepMs / 1000 + random(),
  }),
});
simulation.start();
const first = simulation.update();
simulation.pause();
simulation.update(); // no change
simulation.resume();
simulation.update();
simulation.stop();
```

`start()` resets initial state, tick zero, and the seeded random stream. Calling
start while running or paused throws. `stop()` retains the final snapshot until
next start. Pause/resume outside their applicable states are no-ops. Update
advances exactly one step when running; otherwise it returns the current state.

The reducer receives the next tick (first = 1), fixed `stepMs`, elapsed simulation
time (`tick * stepMs`), and a deterministic random function. Configuration is
copied and the initial state is cloned/frozen. `stepMs` must be finite and positive;
integer seeds normalize to an unsigned 32-bit state. The random stream uses the
32-bit LCG recurrence `s = (1664525*s + 1013904223) mod 2^32`; it is not
cryptographic. Failed reducers or invalid returned data do not advance state,
tick, or the random stream.

Determinism requires a pure reducer. Do not read wall clocks, call Math.random,
perform I/O, retain the random callback, or mutate external state in a reducer.
Feed external inputs through a deterministic host-controlled sequence. The same
initial state, configuration, inputs, and number of updates replay identically
within compatible JavaScript numeric semantics.

The host owns scheduling. `Scheduler` can request updates; it does not compensate
for slow frames or change simulation time. Renderers can consume snapshots at a
different cadence. There are no graphics, UI, or platform dependencies.

Run `npm run example` for a complete kernel/state/events simulation. Expected
positions are `0.016`, `0.032`, and `0.048`.
