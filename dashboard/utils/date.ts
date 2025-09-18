/**
 * Date utility functions for consistent timezone handling
 * All dates from the backend are in UTC and should be displayed in user's local time
 */

/**
 * Parse a date string from the backend (UTC) and return a Date object
 * @param dateString - ISO date string from backend
 * @returns Date object or null if invalid
 */
export function parseUTCDate(dateString: string | Date | null | undefined): Date | null {
  if (!dateString) return null;

  // If already a Date object, return it
  if (dateString instanceof Date) {
    return dateString;
  }

  // Parse the UTC date string
  const date = new Date(dateString);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    console.warn(`Invalid date string: ${dateString}`);
    return null;
  }

  return date;
}

/**
 * Format a date as relative time (e.g., "5m ago", "2h ago", "3d ago")
 * @param date - Date to format
 * @returns Formatted string
 */
export function formatRelativeTime(date: Date | string | null | undefined): string {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return "Unknown";

  const now = new Date();
  const diff = now.getTime() - parsedDate.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {
    return `${years}y ago`;
  } else if (months > 0) {
    return `${months}mo ago`;
  } else if (weeks > 0) {
    return `${weeks}w ago`;
  } else if (days > 0) {
    return `${days}d ago`;
  } else if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else if (seconds > 0) {
    return `${seconds}s ago`;
  } else {
    return "Just now";
  }
}

/**
 * Format a date as absolute time in local timezone
 * @param date - Date to format
 * @param options - Intl.DateTimeFormatOptions
 * @returns Formatted string
 */
export function formatLocalDateTime(
  date: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return "Unknown";

  return parsedDate.toLocaleString(undefined, options);
}

/**
 * Format a date as short date (e.g., "Jan 15")
 * @param date - Date to format
 * @returns Formatted string
 */
export function formatShortDate(date: Date | string | null | undefined): string {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return "Unknown";

  return parsedDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date as time only (e.g., "2:30 PM")
 * @param date - Date to format
 * @returns Formatted string
 */
export function formatTime(date: Date | string | null | undefined): string {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return "Unknown";

  return parsedDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Calculate duration between two dates
 * @param startDate - Start date
 * @param endDate - End date (defaults to now)
 * @returns Formatted duration string (e.g., "2h 15m")
 */
export function formatDuration(
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined = new Date(),
): string {
  const start = parseUTCDate(startDate);
  const end = parseUTCDate(endDate);

  if (!start || !end) return "Unknown";

  const diff = Math.abs(end.getTime() - start.getTime());
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Check if a date is today
 * @param date - Date to check
 * @returns true if date is today
 */
export function isToday(date: Date | string | null | undefined): boolean {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return false;

  const today = new Date();
  return (
    parsedDate.getDate() === today.getDate() &&
    parsedDate.getMonth() === today.getMonth() &&
    parsedDate.getFullYear() === today.getFullYear()
  );
}

/**
 * Check if a date is within the last N minutes
 * @param date - Date to check
 * @param minutes - Number of minutes
 * @returns true if date is within the last N minutes
 */
export function isWithinMinutes(date: Date | string | null | undefined, minutes: number): boolean {
  const parsedDate = parseUTCDate(date);
  if (!parsedDate) return false;

  const now = new Date();
  const diff = now.getTime() - parsedDate.getTime();
  return diff < minutes * 60000;
}
