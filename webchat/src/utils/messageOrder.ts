import type { Message } from "@/types";

/**
 * Message ordering for the chat window.
 *
 * The list mixes two clocks: server timestamps (messages from the API or the
 * socket) and the shopper's browser clock (optimistic "temp-" messages). A
 * browser clock can be minutes or hours off, so the two are never compared.
 * Rules:
 *   - the greeting is always first, and there is only one: the local
 *     placeholder until the server's own greeting (metadata.isGreeting)
 *     arrives, which then takes its place;
 *   - server messages keep server order among themselves;
 *   - optimistic messages stay where they were added.
 */

/**
 * Parse a server timestamp as UTC. A string without a zone designator would
 * otherwise be read in the browser's local zone and land hours off.
 */
export function parseServerTime(
  value: string | number | Date | null | undefined,
  fallback: number = Date.now(),
): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (!value) return fallback;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  const time = new Date(hasZone ? value : `${value.trim()}Z`).getTime();
  return Number.isNaN(time) ? fallback : time;
}

/** The greeting message the server stores when the conversation starts. */
const isServerGreeting = (message: Message) => message.metadata?.isGreeting === true;

const isServerMessage = (message: Message) =>
  !message.isGreeting && !message.id.startsWith("temp-");

/** Insert `message` into `list` in place, following the rules above. */
export function insertMessage(list: Message[], message: Message): void {
  if (message.isGreeting || isServerGreeting(message)) {
    const existing = list.findIndex((m) => m.isGreeting);
    // The server greeting wins: never put the local placeholder back over it.
    if (existing !== -1 && !isServerGreeting(message) && isServerGreeting(list[existing])) return;
    if (existing !== -1) list.splice(existing, 1);
    list.unshift({ ...message, isGreeting: true });
    return;
  }

  // Walk back past server messages that are newer than this one. Greetings and
  // optimistic messages are barriers: we never reorder across them.
  let index = list.length;
  while (
    index > 0 &&
    isServerMessage(list[index - 1]) &&
    list[index - 1].timestamp > message.timestamp
  ) {
    index--;
  }
  list.splice(index, 0, message);
}
