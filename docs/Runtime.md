# Runtime

## Kernel and services

```ts
import { Kernel, Scheduler, ProcessManager } from '@max/core';
const kernel = new Kernel();
const scheduler = new Scheduler(error => console.error(error));
const processes = new ProcessManager();
processes.register('worker', { start() {}, stop() {} });
kernel.register('scheduler', scheduler);
kernel.register('processes', processes);
await kernel.boot();
await processes.start('worker');
const cancel = scheduler.schedule(() => console.log('tick'), 1000, true);
cancel();
await kernel.shutdown();
```

`Services` stores named `Service` objects (`start` and `stop`, synchronous or
async). Duplicate/empty names and duplicate service instances fail. Retrieve a service with
`kernel.services.get(name)`. Register dependencies first: services start in
registration order and stop in reverse order. The registry is sealed permanently
at first boot to keep restart ordering stable. A new topology requires a new
kernel.

Kernel lifecycle calls serialize. Booting an already running kernel does nothing.
On failure, rollback includes the partially started service and all prior starts.
Stop implementations must tolerate partial initialization. Shutdown attempts all
active services and aggregates errors. Failed stops remain tracked for another
shutdown attempt; reboot is blocked until cleanup succeeds. `status` describes
the lifecycle transition, not proof that a failed cleanup released resources.

`ProcessManager` provides named independent lifecycles backed by kernels. Calling
`start(name)` or `stop(name)` affects one process; `stop()` shuts down all processes
and aggregates errors. Manager operations serialize so a concurrent start cannot
escape shutdown. After stop-all, named starts reject until the no-argument
`start()` service hook re-enables the manager; processes are started explicitly.
Hosts should quiesce producers before shutting down the owning kernel.

## Scheduler

Scheduling is explicit and independent from simulation time. A one-shot job runs
after a nonnegative delay. A repeating job requires a positive delay and schedules
the next run **after** the previous promise settles. Jobs do not overlap themselves.
Maximum supported delay is 2,147,483,647 milliseconds. Cancel prevents future
runs; it cannot abort already-running application work. Stop cancels all future
runs and waits for in-flight work. Start re-enables scheduling; canceled jobs do
not reappear. Tasks that never settle prevent graceful shutdown.

The required `onError` callback receives task errors. It should be synchronous
and nonthrowing. Hosts can supply a `Timer` (`set`, `clear`) for testing or native
integration; timer callbacks must run asynchronously. The default timer uses
standard global setTimeout/clearTimeout and is only invoked when scheduling.

## Detection

`detectPlatform`, `detectBrowser`, `detectRenderer`, and `detectPersistence` accept
an optional `DetectionEnvironment`. Native hosts should provide
`nativePlatform` and capabilities directly. Browser callers may use the default
`browserEnvironment()` probe. Imports never probe the environment.

```ts
import { detectRuntime } from '@max/core';
const capabilities = await detectRuntime();
// { platform, browser, wasm, webgl, webgpu, pwa, persistentStorage, policy }
```

- Platform: web, ios, android, desktop, or unknown. Electron is desktop. Ordinary
  desktop browsers are web. iPad desktop-style user agents use Mac + multitouch.
- Browser: safari, chrome, firefox, edge, or unknown; browser-specific tokens take
  precedence over the common Safari token.
- Renderer fields report API/context availability, not successful resource
  allocation. WebGPU device creation and WASM module execution remain host checks.
- PWA means standalone display mode / iOS standalone, not install eligibility.
- Persistent storage means IndexedDB exists and `storage.persisted()` confirms
  eviction protection. Missing/denied probes return false. No permission prompts
  are issued automatically.

Safari and iOS receive memory safe mode, storage safe mode, and image fallback
mode. The policy recommends image rendering for these environments. Android
prefers WASM compute and WebGPU when available; it falls back to JavaScript and
WebGL/images. These are policy signals for host implementation: MAX-CORE does not
allocate image buffers or ship renderer engines. User-agent detection is best
effort; injected host signals are more reliable, particularly on native wrappers.
