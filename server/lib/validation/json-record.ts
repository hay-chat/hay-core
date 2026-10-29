import { z } from "zod";

/** A JSON object whose serialized form stays under `maxBytes` (UTF-8). */
export function boundedJsonRecord(maxBytes: number) {
  return z
    .record(z.unknown())
    .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes, {
      message: `Must be at most ${maxBytes} bytes`,
    });
}
