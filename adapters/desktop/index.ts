import type { AdapterOptions } from '../platform.js';
import { createPlatformAdapter } from '../platform.js';
export function createDesktopAdapter(options: AdapterOptions = {}) { return createPlatformAdapter('desktop', options); }
