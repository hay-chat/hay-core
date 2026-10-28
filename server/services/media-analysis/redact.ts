/**
 * Card numbers never leave the vision pass (D8-12): anything that looks like a
 * payment card number (13-19 digits, optionally grouped by spaces or dashes,
 * passing the Luhn check) is replaced in every text we store or show the AI.
 *
 * @module services/media-analysis/redact
 */

export const CARD_NUMBER_PLACEHOLDER = "[card number removed]";

const CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactCardNumbers(text: string): string {
  return text.replace(CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)
      ? CARD_NUMBER_PLACEHOLDER
      : match;
  });
}
