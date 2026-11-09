const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;

const SCRUBBERS: Array<[RegExp, string]> = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  [/\beyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, "[token]"],
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[token]"],
  [/\+?\d[\d\s().-]{7,}\d/g, "[number]"],
  // Query strings and fragments in script URLs can carry tokens.
  [/(https?:\/\/[^\s?#)]+)[?#][^\s:)]*/g, "$1"],
];

function scrub(text: string, maxLength: number): string {
  return SCRUBBERS.reduce((out, [pattern, to]) => out.replace(pattern, to), text).slice(
    0,
    maxLength,
  );
}

/**
 * The form of an uncaught error that may leave the browser: emails, tokens and
 * long numbers are removed, and a thrown non-Error value is never sent.
 */
export function sanitizeError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("Non-Error value thrown");
  const clean = new Error(scrub(error.message, MAX_MESSAGE_LENGTH));
  clean.name = error.name;
  clean.stack = error.stack ? scrub(error.stack, MAX_STACK_LENGTH) : undefined;
  return clean;
}
