# Runtime

## Architecture and responsibilities

`Kernel` composes service registry, lifecycle manager, scheduler, execution context
and process manager. There is no product owner. Services start in registration
order and stop in reverse. Replace services only while idle/stopped. Named service
resolution is generic; callers own agreement about each name's type.

## Public APIs

- `ServiceRegistry`: register, replace, resolve, entries (independent array).
- `Scheduler`: enqueue, pending, drain, clear. Explicit FIFO, single active drain.
  Tasks enqueued by a running task execute later in that drain. A failed task is
  removed; following tasks remain queued. No timers or execution budget is hidden.
- `ProcessManager(contextFactory)`: spawn, size, stop. Handles expose id, result,
  cancel. IDs may be reused after settlement. No spawning while stopping.
- `Kernel(clock?)`: register, replace, resolve, start, stop, spawn, scheduler, status.
- `ExecutionContext`: immutable `{ signal, now, resolve }`.

## Example

```ts
const kernel = new Kernel(() => performance.now());
kernel.register('transport', {
  start: async context => { console.log(context.signal.aborted); },
  stop: async () => { /* close host transport */ }
});
await kernel.start();
const process = kernel.spawn('job', async context => {
  if (context.signal.aborted) return;
  return context.now();
});
await process.result;
await kernel.stop();
```

## Failure modes

Concurrent lifecycle transitions reject. Failed startup aborts the execution
context and rolls back all attempted services, including the partially started
one. Rollback and shutdown errors aggregate after all stop handlers run. Stopped
kernels can restart. Services must support stop after partial initialization.

Processes run on the next microtask and retain original result/rejection.
Cancellation is cooperative: work must observe its signal and settle. Stop aborts
all active processes and waits for settlement before stopping services. A process
that ignores abort and never settles prevents shutdown. Scheduler tasks are
separate from managed processes; clear removes pending tasks but cannot preempt a
running drain. Hosts must coordinate drains with lifecycle boundaries.

## Recovery

Repair start/stop handlers before restarting. On shutdown errors, inspect the
aggregate and clean external resources that a failed stop handler left open.
Always observe process results. Do not await kernel shutdown from a process whose
own completion shutdown awaits. Bound host I/O and honor abort signals. Run long
scheduled work as a managed process if shutdown must wait for it.
