/**
 * Cheap, model-free signals about an AI reply, used where an LLM guardrail
 * cannot run (it errored) or is skipped (greeting/closing turns). They err on
 * the side of review: a false positive costs a handoff, a false negative lets
 * an unchecked amount, link or claimed action reach the customer.
 */

const DIGIT = /\d/;
const CURRENCY = /[$€£¥₹₩₽₺₫₱₪฿]|\b(?:usd|eur|gbp|brl|cad|aud|jpy|chf|mxn|ars|clp|cop)\b/i;
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|shop|store|app|link|ly)\b/i;

// Stems of state-changing verbs (en/pt/es) a reply would use to say it did something.
const ACTION_VERB =
  /\b(?:cancel|refund|charg|ship|dispatch|book|schedul|reserv|updat|chang|creat|delet|remov|issu|process|credit|replac|exchang|subscrib|reset|sent|reembols|estorn|envi|agend|atualiz|actualiz|alter|devolv|troc|cambi)\w*/i;

/** Numbers, currency, or links: specifics a reply should not state unchecked. */
export function hasFactualSpecifics(reply: string): boolean {
  return DIGIT.test(reply) || CURRENCY.test(reply) || LINK.test(reply);
}

/** A reply that may claim an action, state an amount, or send a link. */
export function isWriteAdjacentReply(reply: string): boolean {
  return hasFactualSpecifics(reply) || ACTION_VERB.test(reply);
}
