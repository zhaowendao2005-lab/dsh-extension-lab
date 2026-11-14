/**
 * esbuild `inject` shim: every `.jsx` view compiles to `h(...)` calls and gets the
 * binding from here, so views never import React or the runtime's h themselves.
 */
export { h, Fragment } from './runtime.js';
