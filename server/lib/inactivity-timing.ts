/**
 * How long a customer can stay silent before the AI checks in, and before it
 * closes the conversation. A channel plugin declares this in its package.json
 * (`hay-plugin.inactivity`); webchat, the one channel core owns, uses
 * WEB_INACTIVITY. Channels that declare nothing use the
 * CONVERSATION_INACTIVITY_INTERVAL env value as the close delay and half of
 * it as the check-in.
 *
 * After `warningMinutes` the AI checks in (omitted = no check-in), after
 * `closeMinutes` it closes with a sign-off, and after twice that it closes
 * silently.
 */
export interface InactivityTiming {
  warningMinutes?: number;
  closeMinutes: number;
}

export const INACTIVITY_MINUTES_LIMITS = { min: 1, max: 14 * 24 * 60 } as const;

export const WEB_INACTIVITY: InactivityTiming = { warningMinutes: 15, closeMinutes: 30 };

export function isValidInactivityTiming(value: unknown): value is InactivityTiming {
  if (!value || typeof value !== "object") return false;
  const { warningMinutes, closeMinutes } = value as Partial<InactivityTiming>;
  const inRange = (n: unknown): n is number =>
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= INACTIVITY_MINUTES_LIMITS.min &&
    n <= INACTIVITY_MINUTES_LIMITS.max;
  if (!inRange(closeMinutes)) return false;
  return warningMinutes === undefined || (inRange(warningMinutes) && warningMinutes < closeMinutes);
}

export interface InactivityThresholds {
  /** null = this channel gets no check-in before the close. */
  warningMs: number | null;
  closeMs: number;
  silentCloseMs: number;
}

/** The channel's declared timing, else the env interval (check-in at half). */
export function resolveInactivityThresholds(
  timing: InactivityTiming | undefined,
  fallbackCloseMs: number,
): InactivityThresholds {
  if (!timing) {
    return {
      warningMs: fallbackCloseMs / 2,
      closeMs: fallbackCloseMs,
      silentCloseMs: fallbackCloseMs * 2,
    };
  }
  const closeMs = timing.closeMinutes * 60_000;
  return {
    warningMs: timing.warningMinutes === undefined ? null : timing.warningMinutes * 60_000,
    closeMs,
    silentCloseMs: closeMs * 2,
  };
}
