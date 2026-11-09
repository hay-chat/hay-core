/**
 * Maps the Conversations list filter options to what the server stores:
 * statuses are `Conversation.status` values, the timeframe becomes a created_at
 * lower bound (`dateRange.from`).
 */

export type StatusFilter = "" | "active" | "resolved" | "unresolved" | "escalated" | "closed";
export type TimeframeFilter = "today" | "week" | "month" | "all";

const STATUSES_BY_FILTER: Record<Exclude<StatusFilter, "">, string[]> = {
  // Still in progress with the AI: not waiting on, or held by, a human.
  active: ["open", "processing", "awaiting-approval"],
  resolved: ["resolved"],
  unresolved: ["unresolved"],
  // Handed off to a human: waiting for one, or one has taken over.
  escalated: ["pending-human", "human-took-over"],
  closed: ["closed"],
};

export function statusesForFilter(filter: StatusFilter): string[] | undefined {
  return filter ? STATUSES_BY_FILTER[filter] : undefined;
}

/** Today is since local midnight; week and month are the last 7 and 30 days. */
export function timeframeStart(timeframe: TimeframeFilter, now = new Date()): Date | undefined {
  if (timeframe === "all") return undefined;
  if (timeframe === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const days = timeframe === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
