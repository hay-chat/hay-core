import { createHmac } from "crypto";
import { config } from "@server/config/env";

/**
 * A signing key for one purpose. Each label gives an unrelated key, so a
 * signature made for one purpose is meaningless for any other.
 *
 * Derived from HAY_SERVICE_KEY when set, which lets JWT_SECRET be rotated
 * without touching these keys, otherwise from JWT_SECRET.
 */
export function deriveServiceKey(label: string): Buffer {
  const root = config.serviceKey || config.jwt.secret;
  if (!root) {
    throw new Error("JWT_SECRET is required to derive signing keys");
  }
  return createHmac("sha256", root).update(label).digest();
}
