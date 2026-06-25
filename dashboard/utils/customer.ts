// Helpers for deriving display-friendly customer info from the Customer entity.
//
// Channel plugins stash per-channel profile data under
// `external_metadata[channel]` (e.g. `{ username, profileName, profile_pic,
// firstSeenAt }` for Instagram). The handle/avatar are NOT first-class columns,
// so these helpers extract them safely without leaking `any` into callers.

/** Minimal shape of a customer as returned by the API. */
export interface CustomerLike {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  external_id?: string | null;
  external_metadata?: Record<string, unknown> | null;
}

/** Per-channel profile fields pulled out of `external_metadata[channel]`. */
export interface CustomerChannelInfo {
  /** Platform handle without the leading "@" (e.g. Instagram username). */
  handle: string | null;
  /** Display name reported by the platform. */
  profileName: string | null;
  /** Avatar/profile picture URL, if the platform provided one. */
  avatarUrl: string | null;
  /** ISO timestamp the customer was first seen on this channel. */
  firstSeenAt: string | null;
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** Extract per-channel profile info from a customer's external_metadata. */
export const getCustomerChannelInfo = (
  customer: CustomerLike | null | undefined,
  channel?: string | null,
): CustomerChannelInfo => {
  const empty: CustomerChannelInfo = {
    handle: null,
    profileName: null,
    avatarUrl: null,
    firstSeenAt: null,
  };
  if (!customer?.external_metadata || !channel) return empty;

  const meta = customer.external_metadata[channel];
  if (typeof meta !== "object" || meta === null) return empty;

  const m = meta as Record<string, unknown>;
  return {
    handle: asString(m["username"]),
    profileName: asString(m["profileName"]),
    avatarUrl: asString(m["profile_pic"]) ?? asString(m["profilePic"]),
    firstSeenAt: asString(m["firstSeenAt"]),
  };
};

/**
 * Best-effort display name for a customer: explicit name → channel handle →
 * channel profile name → bare external_id (stripped of its channel prefix) →
 * "Unknown".
 */
export const getCustomerDisplayName = (
  customer: CustomerLike | null | undefined,
  channel?: string | null,
): string => {
  if (!customer) return "Unknown";
  if (customer.name) return customer.name;

  const info = getCustomerChannelInfo(customer, channel);
  if (info.handle) return `@${info.handle}`;
  if (info.profileName) return info.profileName;

  if (customer.external_id) {
    // Strip a "channel:" prefix so we don't show "instagram:1784..." raw.
    const idx = customer.external_id.indexOf(":");
    return idx >= 0 ? customer.external_id.slice(idx + 1) : customer.external_id;
  }
  return "Unknown";
};

/** First letter of the display name, for avatar fallbacks. */
export const getCustomerInitial = (
  customer: CustomerLike | null | undefined,
  channel?: string | null,
): string => {
  const name = getCustomerDisplayName(customer, channel);
  const stripped = name.startsWith("@") ? name.slice(1) : name;
  return (stripped.charAt(0) || "?").toUpperCase();
};
