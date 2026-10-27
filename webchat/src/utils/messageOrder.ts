import type { Message } from "@/types";

/**
 * Message ordering for the chat window.
 *
 * The list mixes two clocks: server timestamps (messages from the API or the
 * socket) and the shopper's browser clock (optimistic "temp-" messages). A
 * browser clock can be minutes or hours off, so the two are never compared.
 * Rules:
 *   - the local greeting is always first;
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

const isServerMessage = (message: Message) =>
  !message.isGreeting && !message.id.startsWith("temp-");

/** Insert `message` into `list` in place, following the rules above. */
export function insertMessage(list: Message[], message: Message): void {
  if (message.isGreeting) {
    const existing = list.findIndex((m) => m.isGreeting);
    if (existing !== -1) list.splice(existing, 1);
    list.unshift(message);
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
