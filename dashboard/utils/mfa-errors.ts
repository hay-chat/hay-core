/** The translation key for a failed two-factor request. */
export function mfaErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Too many")) return "profile.mfa.errors.tooMany";
  if (message.includes("Password is incorrect")) return "profile.mfa.errors.wrongPassword";
  if (message.includes("Invalid verification code")) return "profile.mfa.errors.invalidCode";
  if (message.includes("last method")) return "profile.mfa.errors.lastFactor";
  if (message.includes("Security key") || message.includes("security key")) {
    return message.includes("unavailable") || message.includes("not configured")
      ? "profile.mfa.errors.keysUnavailable"
      : "profile.mfa.errors.keyFailed";
  }
  if (message.includes("already registered")) return "profile.mfa.errors.keyDuplicate";
  if (message.includes("timed out")) return "profile.mfa.errors.keyFailed";
  return "profile.mfa.errors.generic";
}
