/** Escape user text used inside a SQL LIKE/ILIKE pattern, so `%` and `_` match literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
