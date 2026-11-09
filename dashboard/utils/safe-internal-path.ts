const INTERNAL_BASE = "http://internal.invalid";

/**
 * `value` when it is a path inside this app, otherwise `fallback`. Parsing the
 * way a browser does also catches forms that only become off-site once parsed,
 * such as backslashes, embedded tabs and `..` segments.
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  try {
    const url = new URL(value, INTERNAL_BASE);
    return url.origin === INTERNAL_BASE && !url.pathname.startsWith("//") ? value : fallback;
  } catch {
    return fallback;
  }
}
