import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { withLogContext } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { startDetachedSpan } from "@server/lib/tracing";

const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives each request an id: echoed in X-Request-Id, attached to every log line
 * written while handling it, and included in tRPC error responses. A
 * well-formed id from an upstream proxy is kept so logs correlate across hops.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get("x-request-id");
  const requestId = inbound && ACCEPTED_REQUEST_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  // A new trace per request: the caller's trace headers are not trusted. The
  // span carries the method and route pattern, never the URL, which can hold tokens.
  const span = startDetachedSpan("HTTP request", { "http.method": req.method }, { root: true });
  res.on("finish", () => {
    metrics.httpRequests.inc({ status_class: `${Math.floor(res.statusCode / 100)}xx` });
    span?.end(
      { "http.status_code": res.statusCode, "http.route": req.route?.path },
      res.statusCode >= 500,
    );
  });
  res.on("close", () => {
    if (!res.writableFinished) span?.end({}, true);
  });
  const proceed = () => withLogContext({ requestId }, next);
  if (span) span.run(proceed);
  else proceed();
}
