import type posthog from "posthog-js";

/**
 * Thin, always-safe wrapper around PostHog.
 *
 * The PostHog plugin only provides `$posthog` when POSTHOG_KEY is set, and it is
 * client-only, so `$posthog` is absent during SSR and in any install without a
 * key. Every function here degrades to a no-op in that case, which means callers
 * never need their own guard.
 */
export function useTelemetry() {
  const resolveClient = (): typeof posthog | null => {
    try {
      return (useNuxtApp().$posthog as typeof posthog | undefined) ?? null;
    } catch {
      // useNuxtApp() throws outside a Nuxt context (e.g. a store action called
      // from a plain module). Telemetry is never important enough to propagate.
      return null;
    }
  };

  /**
   * Tie the current session to a user so an error or replay can be traced back
   * to the customer who hit it. Only stable, low-sensitivity attributes are sent.
   */
  const identify = (user: { id: string; email: string; name?: string | null }) => {
    resolveClient()?.identify(user.id, {
      email: user.email,
      ...(user.name ? { name: user.name } : {}),
    });
  };

  /** Associate subsequent events with an organization for per-customer grouping. */
  const setOrganization = (organization: { id: string; name?: string | null }) => {
    resolveClient()?.group("organization", organization.id, {
      ...(organization.name ? { name: organization.name } : {}),
    });
  };

  /** Drop the identity on logout so the next user isn't merged into this person. */
  const reset = () => {
    resolveClient()?.reset();
  };

  return { identify, setOrganization, reset };
}
