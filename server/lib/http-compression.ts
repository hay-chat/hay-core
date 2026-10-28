import compression from "compression";
import zlib from "zlib";
import type { Request, Response, RequestHandler } from "express";

/**
 * Brotli/gzip for HTTP responses (widget.js, API JSON, dashboard assets served
 * by Express). Negotiated from Accept-Encoding, with `Vary: Accept-Encoding`
 * set by the middleware.
 *
 * Not affected: WebSocket upgrades (they never pass through Express), responses
 * that already carry a Content-Encoding (proxied plugin responses), and bodies
 * under 1 KB. Server-sent events are excluded explicitly, because compression
 * buffers output and would hold events back.
 */
export function httpCompression(): RequestHandler {
  return compression({
    // Quality 5 is ~3 ms for the 128 KB widget (43 KB out); the default 4 gives
    // 45 KB, and 11 gives 39 KB but costs ~150 ms per request.
    brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } },
    filter: (req: Request, res: Response) => {
      const contentType = String(res.getHeader("Content-Type") ?? "");
      if (contentType.startsWith("text/event-stream")) return false;
      return compression.filter(req, res);
    },
  });
}
