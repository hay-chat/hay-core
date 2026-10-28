import { validateUrlForSSRF } from "@server/utils/ssrf";

/**
 * Download a file from a public URL: SSRF-checked, no redirects (a redirect
 * could point past the check), a timeout, and a size cap enforced while
 * reading so an oversized body is never held in memory.
 */
export async function fetchPublicFile(
  url: string,
  options: { maxBytes: number; timeoutMs: number },
): Promise<{ buffer: Buffer; mimeType: string }> {
  await validateUrlForSSRF(url);
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`download failed with status ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > options.maxBytes) throw new Error("file too large");

  const chunks: Buffer[] = [];
  let bytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > options.maxBytes) {
        await reader.cancel();
        throw new Error("file too large");
      }
      chunks.push(Buffer.from(value));
    }
  }
  const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return { buffer: Buffer.concat(chunks), mimeType };
}
