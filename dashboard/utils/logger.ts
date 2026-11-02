/**
 * Dashboard logger. Debug output only appears in development builds; warnings
 * and errors are always reported. Never log tokens or full API payloads.
 */
/* eslint-disable no-console */
export const logger = {
  debug: (...args: unknown[]): void => {
    if (import.meta.dev) console.debug(...args);
  },
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args),
};
