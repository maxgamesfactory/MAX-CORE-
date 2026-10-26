import type { AdapterOptions } from '../platform.js';
import { createPlatformAdapter } from '../platform.js';
export function createAndroidAdapter(options: AdapterOptions = {}) { return createPlatformAdapter('android', options); }
