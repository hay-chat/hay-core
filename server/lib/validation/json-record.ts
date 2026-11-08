import { z } from "zod";

/** A JSON object whose serialized form stays under `maxBytes` (UTF-8). */
export function boundedJsonRecord(maxBytes: number) {
  return z
    .record(z.string(), z.unknown())
    .refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes, {
      message: `Must be at most ${maxBytes} bytes`,
    });
}

/** Keys starting with "_" hold Hay's own bookkeeping and cannot be written by callers. */
function hasNoReservedKeys(value: Record<string, unknown>): boolean {
  return !Object.keys(value).some((key) => key.startsWith("_"));
}

/** A bounded JSON object supplied by a caller for merging into stored context. */
export function publicContextRecord(maxBytes: number) {
  return boundedJsonRecord(maxBytes).refine(hasNoReservedKeys, {
    message: 'Keys starting with "_" are reserved',
  });
}

/** Whether a merged context still fits under `maxBytes`. */
export function fitsInBytes(value: unknown, maxBytes: number): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
}
