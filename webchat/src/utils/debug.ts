// Diagnostic logging that stays silent unless the host opts in with
// `window.HayChat.config.debug = true`. The widget runs on merchants' pages, so
// routine progress messages must not land in their console by default.
// Warnings and errors still use console.warn / console.error directly.

let enabled = false;

export function setDebug(value: boolean | undefined): void {
  enabled = value === true;
}

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
