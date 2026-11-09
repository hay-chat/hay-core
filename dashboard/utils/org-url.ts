/**
 * Dashboard URLs carry the organization as their first segment: /<orgId>/inbox.
 * The router itself only ever sees /inbox (see utils/org-history.ts).
 */

const ORG_SEGMENT = /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pages that do not belong to one organization keep their plain URL. */
const UNSCOPED_PATHS = [
  "/login",
  "/logout",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/accept-invitation",
  "/decline-invitation",
  "/answer-question",
  "/auth",
  "/connect",
  "/demo",
  "/privacy",
  "/suspended",
  "/no-access",
];

/** Where someone lands when a link points at an organization they are not in. */
export const NO_ACCESS_ROUTE = "/no-access";

function isOrgScopedPath(path: string): boolean {
  return !UNSCOPED_PATHS.some((unscoped) => path === unscoped || path.startsWith(`${unscoped}/`));
}

/** Remove a `?org=<uuid>` parameter (links sent before the prefix existed). */
function takeOrgQuery(location: string): { organizationId: string | null; location: string } {
  const hashAt = location.indexOf("#");
  const hash = hashAt === -1 ? "" : location.slice(hashAt);
  const beforeHash = hashAt === -1 ? location : location.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return { organizationId: null, location };

  let organizationId: string | null = null;
  const kept = beforeHash
    .slice(queryAt + 1)
    .split("&")
    .filter((pair) => {
      if (!pair.startsWith("org=") || !UUID.test(pair.slice(4))) return true;
      organizationId = pair.slice(4).toLowerCase();
      return false;
    });
  if (!organizationId) return { organizationId: null, location };

  const path = beforeHash.slice(0, queryAt);
  return {
    organizationId,
    location: `${path}${kept.length ? `?${kept.join("&")}` : ""}${hash}`,
  };
}

/** The organization a location names, and the location the router understands. */
export function splitOrgFromLocation(location: string): {
  organizationId: string | null;
  location: string;
} {
  const fromQuery = takeOrgQuery(location);
  const match = ORG_SEGMENT.exec(fromQuery.location);
  if (!match) return fromQuery;

  const rest = fromQuery.location.slice(match[0].length);
  return {
    organizationId: match[1]!.toLowerCase(),
    location: rest.startsWith("/") ? rest : `/${rest}`,
  };
}

/** `location` as it appears in the browser for this organization. */
export function addOrgToLocation(location: string, organizationId: string | null): string {
  if (!organizationId || ORG_SEGMENT.test(location)) return location;
  const path = location.split(/[?#]/, 1)[0]!;
  if (!isOrgScopedPath(path)) return location;
  return `/${organizationId}${location === "/" ? "" : location}`;
}
