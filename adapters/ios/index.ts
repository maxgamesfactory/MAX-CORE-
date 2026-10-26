import type { AdapterOptions } from '../platform.js';
import { createPlatformAdapter } from '../platform.js';
export function createIosAdapter(options: AdapterOptions = {}) { return createPlatformAdapter('ios', options); }
