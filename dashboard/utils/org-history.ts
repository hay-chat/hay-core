import { createWebHistory, type RouterHistory } from "vue-router";
import { addOrgToLocation, splitOrgFromLocation } from "./org-url";

/** The organization written into URLs: follows the active one. */
let urlOrganizationId: string | null = null;
/** The organization the page was opened for, until the auth middleware has dealt with it. */
let requestedOrganizationId: string | null = null;

export function setUrlOrganization(organizationId: string | null): void {
  urlOrganizationId = organizationId;
}

export function getRequestedOrganization(): string | null {
  return requestedOrganizationId;
}

export function clearRequestedOrganization(): void {
  requestedOrganizationId = null;
}

/**
 * Browser history that shows /<orgId>/inbox while the router works with /inbox.
 * Routes, role checks, `route.path` comparisons and every existing link stay
 * as they are, and each href the router generates carries the organization.
 */
export function createOrgHistory(base?: string): RouterHistory {
  const { pathname, search, hash } = window.location;
  const openedAt = `${pathname}${search}${hash}`;
  const opened = splitOrgFromLocation(openedAt);
  requestedOrganizationId = opened.organizationId;
  urlOrganizationId = opened.organizationId;
  // Nuxt reads window.location directly for the first route, so the address bar
  // has to hold the router's view until the first navigation writes it back.
  if (opened.location !== openedAt) {
    window.history.replaceState(window.history.state, "", opened.location);
  }

  const history = createWebHistory(base);
  const routerLocation = (location: string) => splitOrgFromLocation(location).location;

  return {
    base: history.base,
    get location() {
      return routerLocation(history.location);
    },
    get state() {
      return history.state;
    },
    push: (to, data) => history.push(addOrgToLocation(to, urlOrganizationId), data),
    replace: (to, data) => history.replace(addOrgToLocation(to, urlOrganizationId), data),
    go: (delta, triggerListeners) => history.go(delta, triggerListeners),
    createHref: (location) => history.createHref(addOrgToLocation(location, urlOrganizationId)),
    listen: (callback) =>
      history.listen((to, from, info) => {
        // Back/forward onto another organization's page: its data is not loaded here.
        const organizationId = splitOrgFromLocation(to).organizationId;
        if (organizationId && organizationId !== urlOrganizationId) {
          window.location.reload();
          return;
        }
        callback(routerLocation(to), routerLocation(from), info);
      }),
    destroy: () => history.destroy(),
  };
}
