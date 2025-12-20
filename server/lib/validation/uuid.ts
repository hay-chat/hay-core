/**
 * UUID Validation Utilities
 *
 * Provides validation functions for UUIDs to prevent SQL injection
 * and ensure data integrity when using raw SQL queries.
 *
 * @module validation/uuid
 */

/**
 * UUID v4 validation regex (RFC 4122)
 * Matches format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 * where x is any hex digit and y is one of 8, 9, a, or b
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Relaxed UUID validation (accepts v1-v5)
 * Matches format: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
 * where M is 1-5 (version) and N is 8-b (variant)
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a single UUID
 *
 * @param value - UUID string to validate
 * @param paramName - Parameter name for error message (default: "UUID")
 * @param strict - If true, only accept UUIDv4; if false, accept v1-v5 (default: false)
 * @throws Error if validation fails with descriptive message
 *
 * @example
 * ```typescript
 * validateUuid("123e4567-e89b-12d3-a456-426614174000", "userId");
 * // If invalid, throws: "Invalid UUID format for userId: ..."
 * ```
 */
export function validateUuid(
  value: string,
  paramName: string = "UUID",
  strict: boolean = false
): void {
  const regex = strict ? UUID_V4_REGEX : UUID_REGEX;

  if (!regex.test(value)) {
    throw new Error(
      `Invalid UUID format for ${paramName}: ${value}. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
    );
  }
}

/**
 * Validate and filter an array of UUIDs
 *
 * Filters out invalid UUIDs and returns only valid ones.
 * This is useful when processing user input where some UUIDs might be malformed.
 *
 * @param values - Array of UUID strings to validate
 * @param paramName - Parameter name for logging (default: "UUID array")
 * @param strict - If true, only accept UUIDv4; if false, accept v1-v5 (default: false)
 * @returns Array containing only valid UUIDs
 *
 * @example
 * ```typescript
 * const ids = validateUuidArray(["valid-uuid", "invalid", "another-valid-uuid"]);
 * // Returns: ["valid-uuid", "another-valid-uuid"]
 * ```
 */
export function validateUuidArray(
  values: string[],
  paramName: string = "UUID array",
  strict: boolean = false
): string[] {
  const regex = strict ? UUID_V4_REGEX : UUID_REGEX;
  return values.filter((value) => regex.test(value));
}

/**
 * Check if a string is a valid UUID (non-throwing)
 *
 * Unlike `validateUuid`, this function returns a boolean instead of throwing an error.
 * Useful for conditional logic where you need to check validity without exception handling.
 *
 * @param value - String to check
 * @param strict - If true, only accept UUIDv4; if false, accept v1-v5 (default: false)
 * @returns true if valid UUID, false otherwise
 *
 * @example
 * ```typescript
 * if (isValidUuid(userId)) {
 *   // Process valid UUID
 * } else {
 *   // Handle invalid UUID
 * }
 * ```
 */
export function isValidUuid(value: string, strict: boolean = false): boolean {
  const regex = strict ? UUID_V4_REGEX : UUID_REGEX;
  return regex.test(value);
}
