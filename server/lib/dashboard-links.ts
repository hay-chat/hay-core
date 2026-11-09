/** Dashboard path that opens in `organizationId`, whichever one the reader last used. */
export function orgDashboardPath(organizationId: string, path: string): string {
  return `/${organizationId}${path}`;
}
