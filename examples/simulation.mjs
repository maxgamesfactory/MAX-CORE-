import { Simulation, State, EventBus, Kernel } from '../dist/index.js';
const state = new State({ position: 0 });
const events = new EventBus();
events.subscribe('simulation:step', result => console.log(result));
const simulation = new Simulation({
  initial: { position: 0 }, stepMs: 16, seed: 42,
  reduce: (current, { stepMs }) => ({ position: current.position + stepMs / 1000 }),
});
const runtime = new Kernel();
runtime.register('simulation', { start: () => simulation.start(), stop: () => simulation.stop() });
await runtime.boot();
for (let tick = 0; tick < 3; tick++) {
  await state.set(simulation.update());
  events.emit('simulation:step', state.get());
}
await runtime.shutdown();
