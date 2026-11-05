/**
 * The address to start reading, or null while what is typed is not yet a whole web address.
 * "alma" or "alma." are still being typed; "alma.example" is complete. Accepts a missing scheme.
 */
export function readableWebsite(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const labels = url.hostname.split(".");
  const last = labels[labels.length - 1];
  const wholeHost = labels.length >= 2 && labels.every(Boolean) && /^[a-z]{2,}$/i.test(last);
  return wholeHost ? url.origin : null;
}
