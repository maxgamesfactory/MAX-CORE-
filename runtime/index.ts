import type { RuntimeContract, RuntimeStatus, Service } from '../contracts/index.js';
import { Serial } from '../contracts/value.js';

export class Services {
  private readonly entries = new Map<string, Service>();
  private sealed = false;
  register(name: string, service: Service): void {
    if (this.sealed) throw new Error('Services are sealed while the runtime is active');
    if (!name || this.entries.has(name) || [...this.entries.values()].includes(service)) throw new Error(`Invalid or duplicate service: ${name}`);
    this.entries.set(name, service);
  }
  get(name: string): Service {
    const service = this.entries.get(name);
    if (!service) throw new Error(`Unknown service: ${name}`);
    return service;
  }
  values(): Service[] { return [...this.entries.values()]; }
  /** Used by the owning kernel to prevent lifecycle races. */
  seal(): void { this.sealed = true; }
}

export class Kernel implements RuntimeContract {
  readonly services = new Services();
  private currentStatus: RuntimeStatus = 'stopped';
  private active: Service[] = [];
  private readonly serial = new Serial();
  get status(): RuntimeStatus { return this.currentStatus; }
  register(name: string, service: Service): void { this.services.register(name, service); }
  boot(): Promise<void> {
    this.services.seal();
    return this.serial.run(async () => {
      if (this.status === 'running') return;
      if (this.active.length) throw new Error('Shutdown must finish before reboot');
      this.currentStatus = 'starting';
      try {
        for (const service of this.services.values()) {
          // Include a partially started service in rollback.
          this.active.push(service);
          await service.start();
        }
        this.currentStatus = 'running';
      } catch (error) {
        const errors = await this.stopActive();
        this.currentStatus = 'stopped';
        throw new AggregateError([error, ...errors], 'Runtime boot failed');
      }
    });
  }
  shutdown(): Promise<void> {
    return this.serial.run(async () => {
      this.currentStatus = 'stopping';
      const errors = await this.stopActive();
      this.currentStatus = 'stopped';
      if (errors.length) throw new AggregateError(errors, 'Runtime shutdown failed; retry shutdown');
    });
  }
  private async stopActive(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const service of [...this.active].reverse()) {
      try {
        await service.stop();
        this.active.splice(this.active.indexOf(service), 1);
      } catch (error) { errors.push(error); }
    }
    return errors;
  }
}

/** Processes have independent serialized lifecycles. Register the manager as a kernel service. */
export class ProcessManager implements Service {
  private readonly processes = new Map<string, Kernel>();
  private readonly serial = new Serial();
  private accepting = true;
  register(name: string, process: Service): void {
    if (!name || this.processes.has(name)) throw new Error(`Invalid or duplicate process: ${name}`);
    const kernel = new Kernel();
    kernel.register(name, process);
    this.processes.set(name, kernel);
  }
  private get(name: string): Kernel {
    const process = this.processes.get(name);
    if (!process) throw new Error(`Unknown process: ${name}`);
    return process;
  }
  status(name: string): RuntimeStatus { return this.get(name).status; }
  start(name?: string): Promise<void> {
    return this.serial.run(async () => {
      if (name === undefined) { this.accepting = true; return; }
      if (!this.accepting) throw new Error('Process manager is stopped');
      await this.get(name).boot();
    });
  }
  stop(name?: string): Promise<void> {
    return this.serial.run(async () => {
      if (name !== undefined) return this.get(name).shutdown();
      this.accepting = false;
      const results = await Promise.allSettled([...this.processes.values()].map(process => process.shutdown()));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
      if (errors.length) throw new AggregateError(errors, 'Process shutdown failed');
    });
  }
}

export interface Timer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
const defaultTimer: Timer = {
  set: (callback, delay) => globalThis.setTimeout(callback, delay),
  clear: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};
/** Fixed-delay tasks never overlap. stop cancels timers and waits for running work. */
export class Scheduler implements Service {
  private readonly jobs = new Set<{ cancel(): void; done: Promise<void> | undefined }>();
  private enabled = true;
  constructor(private readonly onError: (error: unknown) => void, private readonly timer: Timer = defaultTimer) {}
  start(): void { this.enabled = true; }
  schedule(task: () => void | Promise<void>, delayMs: number, repeat = false): () => void {
    if (!this.enabled) throw new Error('Scheduler is stopped');
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 2147483647 || (repeat && delayMs === 0)) throw new RangeError('Invalid delay');
    let cancelled = false;
    let handle: unknown;
    const job = {
      done: undefined as Promise<void> | undefined,
      cancel: () => { cancelled = true; this.timer.clear(handle); if (!job.done) this.jobs.delete(job); },
    };
    const run = (): void => {
      if (cancelled) return;
      job.done = Promise.resolve().then(task).catch(this.onError).finally(() => {
        job.done = undefined;
        if (repeat && !cancelled && this.enabled) handle = this.timer.set(run, delayMs);
        else this.jobs.delete(job);
      });
      // onError can itself fail; retain a handled promise for shutdown.
      void job.done.catch(() => undefined);
    };
    this.jobs.add(job);
    handle = this.timer.set(run, delayMs);
    return job.cancel;
  }
  async stop(): Promise<void> {
    this.enabled = false;
    const jobs = [...this.jobs];
    for (const job of jobs) job.cancel();
    await Promise.all(jobs.map(job => job.done));
  }
}
