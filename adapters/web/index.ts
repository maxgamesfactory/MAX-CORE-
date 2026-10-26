import type { AdapterOptions } from '../platform.js';
import { createPlatformAdapter } from '../platform.js';
export function createWebAdapter(options: AdapterOptions = {}) { return createPlatformAdapter('web', options); }
