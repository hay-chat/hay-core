import twilio from "twilio";
const { validateRequest } = twilio;

/**
 * Validate Twilio webhook signature
 *
 * Uses Twilio's HMAC-SHA1 signature validation to verify that webhook
 * requests actually come from Twilio.
 *
 * @param authToken - Twilio Auth Token used as HMAC key
 * @param signature - X-Twilio-Signature header value
 * @param url - The full URL Twilio used to send the request (original, pre-proxy)
 * @param params - The POST body parameters
 * @returns true if signature is valid
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  return validateRequest(authToken, signature, url, params);
}
