import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { mfaErrorKey } from "@/utils/mfa-errors";

/** Whether this browser can use security keys and passkeys. */
export function webauthnSupported(): boolean {
  return !!import.meta.client && browserSupportsWebAuthn();
}

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

// The server builds and validates these options. Its type for the optional
// extension fields differs from the browser package's, hence `unknown` here.
export const askKeyToRegister = (options: unknown) =>
  startRegistration({ optionsJSON: options as RegistrationOptions });

export const askKeyToSign = (options: unknown) =>
  startAuthentication({ optionsJSON: options as AuthenticationOptions });

/** The translation key for a failed security-key request, including the browser's own refusals. */
export function webauthnErrorKey(error: unknown): string {
  const names = [
    error instanceof Error ? error.name : "",
    error instanceof Error && error.cause instanceof Error ? error.cause.name : "",
  ];
  if (names.includes("NotAllowedError") || names.includes("AbortError")) {
    return "profile.mfa.errors.keyCancelled";
  }
  if (names.includes("InvalidStateError")) return "profile.mfa.errors.keyDuplicate";
  return mfaErrorKey(error);
}
