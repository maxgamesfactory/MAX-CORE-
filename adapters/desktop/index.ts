import { createAdapter, type HostCapabilities } from '../index.js';
/** Supply actual host storage and optional SDK bridges at the composition root. */
export const createDesktopAdapter = (host: HostCapabilities) => createAdapter('desktop', host);
