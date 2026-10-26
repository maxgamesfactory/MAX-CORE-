import type { AdapterOptions } from '../platform.js';
import { createPlatformAdapter } from '../platform.js';
export function createXrAdapter(options: AdapterOptions = {}) { return createPlatformAdapter('xr', options); }
