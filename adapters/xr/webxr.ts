import type { JsonObject, XRBridge, XRMode, XRSessionBridge } from '../../contracts/index.js';

export interface WebXRInputEvent {
  type: string;
  inputSource?: { handedness: string; targetRayMode: string };
}
export interface WebXRSession {
  end(): Promise<void>;
  addEventListener(type: string, listener: (event: WebXRInputEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebXRInputEvent) => void): void;
}
export interface WebXRSystem {
  isSessionSupported(mode: XRMode): Promise<boolean>;
  requestSession(mode: XRMode): Promise<WebXRSession>;
}
/** WebXR translation only. Native OpenXR/Quest/visionOS hosts implement XRBridge. */
export class WebXRBridge implements XRBridge {
  readonly runtime = 'webxr' as const;
  constructor(private readonly system: WebXRSystem | undefined = (typeof navigator === 'undefined' ? undefined : (navigator as unknown as { xr?: WebXRSystem }).xr)) {}
  async supported(mode: XRMode): Promise<boolean> {
    try { return await this.system?.isSessionSupported(mode) ?? false; } catch { return false; }
  }
  async request(mode: XRMode): Promise<XRSessionBridge> {
    if (!this.system) throw new Error('WebXR unavailable');
    const session = await this.system.requestSession(mode);
    return {
      end: () => session.end(),
      onInput(listener) {
        const types = ['select', 'selectstart', 'selectend', 'squeeze', 'squeezestart', 'squeezeend'];
        const translate = (event: WebXRInputEvent) => {
          const input: JsonObject = { type: event.type };
          if (event.inputSource) { input.handedness = event.inputSource.handedness; input.targetRayMode = event.inputSource.targetRayMode; }
          listener(input);
        };
        for (const type of types) session.addEventListener(type, translate);
        return () => { for (const type of types) session.removeEventListener(type, translate); };
      },
      onEnd(listener) {
        session.addEventListener('end', listener);
        return () => session.removeEventListener('end', listener);
      }
    };
  }
}
