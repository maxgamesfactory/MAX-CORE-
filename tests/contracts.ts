import { State, EventBus, Simulation, Kernel, MemoryStorage, createWebAdapter, createIosAdapter, createAndroidAdapter, createDesktopAdapter } from '../index.js';
import type { StateContract, EventContract, SimulationContract, StorageContract, RuntimeContract, AdapterContract } from '../index.js';
const state: StateContract<{ count: number }> = new State({ count: 0 });
const events: EventContract<{ changed: { count: number } }> = new EventBus();
const simulation: SimulationContract<number> = new Simulation({ initial: 0, seed: 1, stepMs: 10, reduce: state => state + 1 });
const storage: StorageContract = new MemoryStorage();
const runtime: RuntimeContract = new Kernel();
const adapters: AdapterContract[] = [createWebAdapter, createIosAdapter, createAndroidAdapter, createDesktopAdapter].map(create => create({ storage: new MemoryStorage() }));
void [simulation, storage, runtime, adapters];
// @ts-expect-error State snapshot is immutable.
state.get().count = 1;
// @ts-expect-error Wrong state field type.
void state.set({ count: 'one' });
// @ts-expect-error Event payload is determined by name.
events.emit('changed', { count: 'one' });
// @ts-expect-error Unknown event names are rejected.
events.emit('missing', { count: 1 });
// @ts-expect-error Undefined is not portable JSON.
new State({ count: undefined });
