export interface ExecutionContext {
  readonly signal: AbortSignal;
  readonly now: () => number;
  resolve<T>(name: string): T;
}
export interface RuntimeService {
  start?(context: ExecutionContext): void | Promise<void>;
  stop?(): void | Promise<void>;
}
export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';
export interface ProcessHandle<T> { readonly id: string; readonly result: Promise<T>; cancel(): void }
export interface RuntimeContract {
  readonly status: RuntimeStatus;
  register<T extends RuntimeService>(name: string, service: T): void;
  resolve<T>(name: string): T;
  start(): Promise<void>;
  stop(): Promise<void>;
  spawn<T>(id: string, work: (context: ExecutionContext) => Promise<T>): ProcessHandle<T>;
}
