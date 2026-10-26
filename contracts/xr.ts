import type { JsonObject, Outcome } from './common.js';
export type XRMode = 'inline' | 'immersive-vr' | 'immersive-ar';
export interface XRSessionBridge {
  end(): Promise<void>;
  /** Raw platform input is translated to portable JSON at the bridge boundary. */
  onInput(listener: (input: JsonObject) => void): () => void;
  onEnd(listener: () => void): () => void;
}
export interface XRBridge {
  readonly runtime: 'webxr' | 'openxr' | 'quest' | 'visionos' | 'custom';
  supported(mode: XRMode): Promise<boolean>;
  request(mode: XRMode): Promise<XRSessionBridge>;
}
export interface XRContract {
  readonly active: boolean;
  start(mode: XRMode): Promise<Outcome<void>>;
  stop(): Promise<void>;
}
