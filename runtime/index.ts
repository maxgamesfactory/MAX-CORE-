import type { ExecutionContext, ProcessHandle, RuntimeContract, RuntimeService, RuntimeStatus } from '../contracts/index.js';

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();
  register<T>(name: string, service: T): void {
    if (!name || this.services.has(name)) throw new Error(`Invalid or duplicate service: ${name}`);
    this.services.set(name, service);
  }
  replace<T>(name: string, service: T): void {
    if (!this.services.has(name)) throw new Error(`Unknown service: ${name}`);
    this.services.set(name, service);
  }
  resolve<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`Unknown service: ${name}`);
    return this.services.get(name) as T;
  }
  entries(): [string, unknown][] { return [...this.services.entries()]; }
}

/** Explicit FIFO execution; no hidden wall-clock loop. */
export class Scheduler {
  private readonly queue: (() => void | Promise<void>)[] = [];
  private draining = false;
  enqueue(task: () => void | Promise<void>): void { this.queue.push(task); }
  get pending(): number { return this.queue.length; }
  clear(): void { this.queue.length = 0; }
  async drain(): Promise<void> {
    if (this.draining) throw new Error('Scheduler already draining');
    this.draining = true;
    try {
      while (this.queue.length) await this.queue.shift()!();
    } finally { this.draining = false; }
  }
}

export class ProcessManager {
  private stopping = false;
  private readonly processes = new Map<string, { controller: AbortController; result: Promise<unknown> }>();
  constructor(private readonly context: (signal: AbortSignal) => ExecutionContext) {}
  spawn<T>(id: string, work: (context: ExecutionContext) => Promise<T>): ProcessHandle<T> {
    if (this.stopping) throw new Error('Process manager is stopping');
    if (!id || this.processes.has(id)) throw new Error(`Invalid or duplicate process: ${id}`);
    const controller = new AbortController();
    const result = Promise.resolve().then(() => work(this.context(controller.signal)));
    this.processes.set(id, { controller, result });
    // Attach rejection handling immediately; callers still receive the original rejection.
    void result.then(() => this.processes.delete(id), () => this.processes.delete(id));
    return { id, result, cancel: () => controller.abort() };
  }
  get size(): number { return this.processes.size; }
  async stop(): Promise<void> {
    if (this.stopping) throw new Error('Process manager is stopping');
    this.stopping = true;
    try {
      const active = [...this.processes.values()];
      for (const process of active) process.controller.abort();
      await Promise.allSettled(active.map(process => process.result));
    } finally { this.stopping = false; }
  }
}

export class Kernel implements RuntimeContract {
  private readonly registry = new ServiceRegistry();
  readonly scheduler = new Scheduler();
  private readonly processes: ProcessManager;
  private controller = new AbortController();
  private phase: RuntimeStatus = 'idle';
  private started: RuntimeService[] = [];
  constructor(private readonly clock: () => number = () => Date.now()) {
    this.processes = new ProcessManager(signal => this.context(signal));
  }
  get status(): RuntimeStatus { return this.phase; }
  register<T extends RuntimeService>(name: string, service: T): void { this.requireInactive(); this.registry.register(name, service); }
  replace<T extends RuntimeService>(name: string, service: T): void { this.requireInactive(); this.registry.replace(name, service); }
  resolve<T>(name: string): T { return this.registry.resolve<T>(name); }
  async start(): Promise<void> {
    this.requireInactive(); this.phase = 'starting'; this.controller = new AbortController();
    try {
      for (const [, service] of this.registry.entries()) {
        const lifecycle = service as RuntimeService;
        // Include a partially started service in rollback.
        this.started.push(lifecycle);
        await lifecycle.start?.(this.context(this.controller.signal));
      }
      this.phase = 'running';
    } catch (error) {
      this.controller.abort();
      const failures = await this.stopServices();
      this.phase = 'stopped';
      throw new AggregateError([error, ...failures], 'Runtime startup failed');
    }
  }
  async stop(): Promise<void> {
    if (this.phase === 'starting' || this.phase === 'stopping') throw new Error('Runtime transition in progress');
    this.phase = 'stopping'; this.controller.abort(); this.scheduler.clear();
    await this.processes.stop();
    const errors = await this.stopServices();
    this.phase = 'stopped';
    if (errors.length) throw new AggregateError(errors, 'Runtime shutdown failed');
  }
  spawn<T>(id: string, work: (context: ExecutionContext) => Promise<T>): ProcessHandle<T> {
    if (this.phase !== 'running') throw new Error('Runtime is not running');
    return this.processes.spawn(id, work);
  }
  private context(signal: AbortSignal): ExecutionContext { return Object.freeze({ signal, now: this.clock, resolve: <T>(name: string) => this.resolve<T>(name) }); }
  private requireInactive(): void {
    if (this.phase !== 'idle' && this.phase !== 'stopped') throw new Error('Runtime must be inactive');
  }
  private async stopServices(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const service of this.started.reverse()) {
      try { await service.stop?.(); } catch (error) { errors.push(error); }
    }
    this.started = [];
    return errors;
  }
}
