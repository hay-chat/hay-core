import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { withLogContext } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";

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
  res.on("finish", () => {
    metrics.httpRequests.inc({ status_class: `${Math.floor(res.statusCode / 100)}xx` });
  });
  withLogContext({ requestId }, next);
}
