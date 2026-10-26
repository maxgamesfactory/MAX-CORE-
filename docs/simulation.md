# Simulation engine

## Architecture and responsibilities

`Simulation<S,C>` advances an immutable state through a pure reducer and a fixed
configuration. It has no real-time loop, platform ownership or domain rules. The
same API supports games, economics, governance, civilizations, ecosystems,
worldbuilding, agents and education by injecting domain reducers from consumers.

## Public APIs

- Constructor: initial JSON state, `{ seed, stepMs, parameters }`, reducer.
- `start()` resets initial state, seed and tick and starts from idle/stopped.
- `pause()` requires running; `resume()` requires paused; `stop()` is idempotent.
- `update(steps = 1)` advances positive safe integer steps only while running.
- `get()`, readonly `tick` and `status` expose state and lifecycle.
- `replay(steps = currentTick)` creates an independent running replay from the
  original state and configuration. Zero steps is allowed for replay.
- Reducer receives readonly state and `{ tick, elapsedMs, config, random }`.
  Ticks start at 1; the supplied seeded PRNG returns numbers in `[0,1)`.

## Example

```ts
const simulation = new Simulation<number, { increment: number }>(0,
  { seed: 123, stepMs: 16, parameters: { increment: 2 } },
  (current, frame) => current + frame.config.increment
);
simulation.start(); simulation.update(10);
console.assert(simulation.replay().get() === 20);
simulation.pause(); simulation.resume(); simulation.stop();
```

## Failure modes

Invalid config/state, invalid transitions and overflow reject synchronously.
A reducer error or invalid result preserves that step's previous state, tick and
PRNG state. Earlier steps in the same update remain committed. Holding `random`
after the reducer returns has no effect on committed PRNG state.

## Recovery

Fix the failing reducer/input and retry the uncommitted step. Determinism requires
no Date.now, Math.random, I/O, mutation, captured mutable external state or engine
changes inside reducers. Replay is from initial data, not an external input log;
model replayable external actions in configuration/state or a host-owned command
log. Persist domain checkpoints through storage after validating schema. Do not
skip failed steps or silently change seeds to claim determinism.
