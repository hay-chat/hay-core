import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { safeFetch } from "@server/utils/ssrf";

const logger = createLogger("password-policy");

const BREACH_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const BREACH_LOOKUP_TIMEOUT_MS = 2_000;

/** Rules for a password being set. Signing in keeps a looser check so older passwords work. */
export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/\d/, "Password must include a number")
  .regex(/[^A-Za-z0-9\s]/, "Password must include a special character");

/**
 * Whether the password appears in known breaches, using the k-anonymity range
 * API: only the first 5 hex characters of its SHA-1 leave this server.
 * A lookup that fails counts as "not breached": signing up must not depend on it.
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
  const hash = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const response = await safeFetch(`${BREACH_RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      timeoutMs: BREACH_LOOKUP_TIMEOUT_MS,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Breached-password lookup failed");
      return false;
    }
    return (await response.text()).split("\n").some((line) => {
      const [candidate, count] = line.trim().split(":");
      // Padding rows carry a count of 0.
      return candidate === suffix && Number(count) > 0;
    });
  } catch (error) {
    logger.warn({ err: error }, "Breached-password lookup failed");
    return false;
  }
}

export async function assertPasswordNotBreached(password: string): Promise<void> {
  if (!config.passwordBreachCheck) return;
  if (await isBreachedPassword(password)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This password has appeared in a data breach. Please choose a different one.",
    });
  }
}
