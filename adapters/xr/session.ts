import type { EventContract, JsonObject, Outcome, StateContract, SimulationContract, JsonValue, XRBridge, XRContract, XRMode, XRSessionBridge } from '../../contracts/index.js';

export type XREvents = { 'xr.input': JsonObject };
export interface XRDependencies<S extends JsonObject, W extends JsonValue> {
  state: StateContract<S>;
  events: EventContract<XREvents>;
  simulation: SimulationContract<W>;
  /** Input handlers may run asynchronously. A host diagnostic sink owns reporting. */
  onError: (error: unknown) => void;
}
/** Owns only session translation. State/simulation are the host's shared instances. */
export class XRIntegration<S extends JsonObject, W extends JsonValue> implements XRContract {
  private session: XRSessionBridge | undefined;
  private unsubscribe: (() => void) | undefined;
  private transitioning = false;
  private unsubscribeEnd: (() => void) | undefined;
  constructor(private readonly bridge: XRBridge, readonly shared: XRDependencies<S, W>) {}
  get active(): boolean { return this.session !== undefined; }
  async start(mode: XRMode): Promise<Outcome<void>> {
    if (this.transitioning || this.session) return { supported: false, reason: 'XR session is active or transitioning' };
    this.transitioning = true;
    let requested: XRSessionBridge | undefined;
    try {
      if (!await this.bridge.supported(mode)) return { supported: false, reason: 'XR mode unavailable' };
      requested = await this.bridge.request(mode);
      this.unsubscribe = requested.onInput(input => {
        try { void this.shared.events.emit('xr.input', input).catch(error => this.report(error)); }
        catch (error) { this.report(error); }
      });
      this.session = requested;
      this.unsubscribeEnd = requested.onEnd(() => {
        this.releaseListeners();
      });
      return { supported: true, value: undefined };
    } catch (error) {
      this.releaseListeners();
      if (requested) {
        try { await requested.end(); } catch (cleanupError) { this.report(cleanupError); }
      }
      return { supported: false, reason: error instanceof Error ? error.message : String(error) };
    } finally { this.transitioning = false; }
  }
  private report(error: unknown): void {
    try { this.shared.onError(error); } catch { /* A diagnostic sink must not crash an XR callback. */ }
  }
  private releaseListeners(): void {
    const subscriptions = [this.unsubscribe, this.unsubscribeEnd];
    this.unsubscribe = undefined; this.unsubscribeEnd = undefined; this.session = undefined;
    for (const unsubscribe of subscriptions) {
      try { unsubscribe?.(); } catch (error) { this.report(error); }
    }
  }
  async stop(): Promise<void> {
    if (this.transitioning) throw new Error('XR transition in progress');
    this.transitioning = true;
    const session = this.session;
    this.releaseListeners();
    try { await session?.end(); } finally { this.transitioning = false; }
  }
}
