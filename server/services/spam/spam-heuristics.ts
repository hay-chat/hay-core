/**
 * D9-6: cheap spam heuristics over a webchat conversation's first customer
 * messages. Pure, so it is unit-tested without a database.
 *
 * Each signal adds to a 0..1 score. At SPAM_THRESHOLD the conversation is held
 * as spam; between SUSPICIOUS_THRESHOLD and SPAM_THRESHOLD the optional
 * easy-tier classifier decides (when the owner turned it on).
 */

export const SPAM_THRESHOLD = 0.7;
export const SUSPICIOUS_THRESHOLD = 0.3;

export type SpamSignal =
  | "links"
  | "link_only"
  | "repeated"
  | "too_long"
  | "no_text"
  | "known_pattern"
  | "unverified";

export interface SpamHeuristicsInput {
  /** Customer message texts, oldest first. */
  messages: string[];
  /** The bot check the widget gate recorded at create time, if any. */
  botCheckDecision?: "allow" | "flag" | "deny" | null;
}

export interface SpamHeuristicsResult {
  score: number;
  signals: SpamSignal[];
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const LONG_MESSAGE_CHARS = 2000;

/**
 * Phrases that show up in bot traffic and unsolicited pitches, not shopper
 * questions. Lower-case; matched on word boundaries. Kept short on purpose:
 * the score needs a second signal (links, repeats) for most of these to hold.
 */
const KNOWN_PATTERNS: RegExp[] = [
  /\b(seo|backlinks?|guest posts?|link building)\b/,
  /\brank (your|ur) (website|site)\b/,
  /\b(first page|1st page) of google\b/,
  /\b(crypto|bitcoin|forex|binary options?)\b.*\b(invest|profit|earn|trading)\b/,
  /\b(casino|betting|viagra|cialis|porn|xxx)\b/,
  /\b(earn|make) \$?\d+[\d,]*\+? (per|a) (day|week)\b/,
  /\b(web ?design|app development|lead generation) (services?|agency)\b/,
  /\b(ganhe dinheiro|renda extra|trabalhe de casa)\b/,
  /\b(posicionamento no google|primeira p[aá]gina do google)\b/,
];

function nonLinkText(message: string): string {
  return message.replace(URL_PATTERN, " ").replace(/\s+/g, " ").trim();
}

export function scoreSpam(input: SpamHeuristicsInput): SpamHeuristicsResult {
  const messages = input.messages.map((m) => m.trim()).filter((m) => m.length > 0);
  const signals: SpamSignal[] = [];
  let score = 0;
  const add = (signal: SpamSignal, weight: number) => {
    signals.push(signal);
    score += weight;
  };

  const all = messages.join("\n");
  const links = all.match(URL_PATTERN) ?? [];
  if (links.length >= 3) add("links", 0.5);
  else if (links.length > 0 && nonLinkText(all).length < 20) add("link_only", 0.4);

  const counts = new Map<string, number>();
  for (const m of messages) {
    const key = m.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeatedMessage = [...counts.values()].some((n) => n >= 3);
  const repeatedRun = /(.)\1{19,}/.test(all) || /\b(\w{2,})\b(?:\W+\1\b){7,}/i.test(all);
  if (repeatedMessage || repeatedRun) add("repeated", 0.4);

  if (messages.some((m) => m.length > LONG_MESSAGE_CHARS)) add("too_long", 0.3);
  if (messages.length > 0 && !/\p{L}/u.test(all)) add("no_text", 0.3);

  const lower = all.toLowerCase();
  const patternHits = KNOWN_PATTERNS.filter((p) => p.test(lower)).length;
  if (patternHits > 0) add("known_pattern", Math.min(0.4 + 0.2 * (patternHits - 1), 0.6));

  // A failed or missing challenge is not spam on its own (the provider may be
  // down), but it tips a borderline conversation.
  if (input.botCheckDecision === "flag") add("unverified", 0.2);

  return { score: Math.min(Math.round(score * 100) / 100, 1), signals };
}
