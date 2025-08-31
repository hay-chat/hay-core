/**
 * Date utility functions for consistent UTC timestamp handling.
 * All server-side operations should use UTC timestamps for consistency.
 */

/**
 * Get current UTC timestamp
 * @returns Date object representing current UTC time
 */
export function getUTCNow(): Date {
  return new Date();
}

/**
 * Convert any date to UTC timestamp
 * @param date Date to convert (string, number, or Date)
 * @returns Date object in UTC
 */
export function toUTC(date: string | number | Date): Date {
  if (date instanceof Date) {
    return new Date(date.toISOString());
  }
  return new Date(new Date(date).toISOString());
}

/**
 * Get UTC timestamp from milliseconds
 * @param ms Milliseconds since epoch
 * @returns Date object in UTC
 */
export function getUTCFromMs(ms: number): Date {
  return new Date(ms);
}

/**
 * Calculate time difference in milliseconds between two dates
 * @param date1 First date
 * @param date2 Second date
 * @returns Difference in milliseconds
 */
export function getTimeDifference(date1: Date | string, date2: Date | string): number {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);
  return Math.abs(d1.getTime() - d2.getTime());
}

/**
 * Add milliseconds to a date
 * @param date Base date
 * @param ms Milliseconds to add
 * @returns New Date object
 */
export function addMilliseconds(date: Date | string, ms: number): Date {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + ms);
}

/**
 * Check if a date is in the past
 * @param date Date to check
 * @returns True if date is in the past
 */
export function isPast(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() < Date.now();
}

/**
 * Check if a date is in the future
 * @param date Date to check
 * @returns True if date is in the future
 */
export function isFuture(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() > Date.now();
}

/**
 * Format a timestamp for consistent logging
 * @param date Date to format
 * @returns ISO string representation
 */
export function formatUTC(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}