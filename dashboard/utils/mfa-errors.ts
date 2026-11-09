/** The translation key for a failed two-factor request. */
export function mfaErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Too many")) return "profile.mfa.errors.tooMany";
  if (message.includes("Password is incorrect")) return "profile.mfa.errors.wrongPassword";
  if (message.includes("Invalid verification code")) return "profile.mfa.errors.invalidCode";
  return "profile.mfa.errors.generic";
}
