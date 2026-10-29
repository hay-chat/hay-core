import { TRPCError } from "@trpc/server";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("trpc");

/**
 * The error a failed procedure returns to the client: a TRPCError passes
 * through unchanged; anything else is logged and replaced by `message`, so
 * internal details (SQL, file paths, upstream responses) never reach the
 * response.
 */
export function toClientError(
  error: unknown,
  code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR",
  message: string,
): TRPCError {
  if (error instanceof TRPCError) {
    return error;
  }
  logger.warn({ err: error }, message);
  return new TRPCError({ code, message });
}
