import type { Request } from "express";
import { authenticate } from "@server/lib/auth/middleware";
import { DEFAULT_BODY_LIMIT_BYTES } from "@server/lib/body-limits";
import { verifyPluginApiToken } from "@server/lib/plugin-api-token";

/**
 * Whether a request may send an upload-sized body. Parsing runs before the
 * routes, so this is where anonymous callers are held to the default limit.
 */
export async function mayParseLargeBody(req: Request): Promise<boolean> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared <= DEFAULT_BODY_LIMIT_BYTES) return true;

  const header = req.headers.authorization;
  if (!header) return false;

  if (header.startsWith("Bearer ")) {
    try {
      verifyPluginApiToken(header.slice("Bearer ".length));
      return true;
    } catch {
      // Not a plugin token: try the staff credentials below.
    }
  }
  try {
    return (await authenticate(req)) !== null;
  } catch {
    return false;
  }
}
