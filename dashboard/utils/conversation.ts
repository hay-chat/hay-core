/**
 * Conversation utility functions for wait time calculation and formatting
 */

export interface ConversationMessage {
  type: string;
  created_at: string;
  content?: string;
}

export interface ConversationWithMessages {
  id: string;
  status: string;
  messages?: ConversationMessage[];
}

/**
 * Calculate wait time for a conversation in seconds
 * Returns null if no wait time is applicable (< 30s or already responded)
 */
export const getWaitTime = (conversation: ConversationWithMessages): number | null => {
  // Only calculate wait time for conversations that might need attention
  const validStatuses = [
    "open",
    "processing",
    "pending-human",
    "awaiting-approval",
    "human-took-over",
  ];
  if (!validStatuses.includes(conversation.status)) {
    return null;
  }

  // Check if last message was from customer
  if (!conversation.messages || conversation.messages.length === 0) {
    return null;
  }

  // Find last customer message
  const lastCustomerMessage = [...conversation.messages]
    .reverse()
    .find((m) => m.type === "Customer");

  if (!lastCustomerMessage) {
    return null;
  }

  // Check if there's a bot or human response after the customer message
  const customerMessageTime = new Date(lastCustomerMessage.created_at);
  const lastBotMessage = [...conversation.messages]
    .reverse()
    .find((m) => m.type === "BotAgent" || m.type === "HumanAgent");

  if (lastBotMessage) {
    const botMessageTime = new Date(lastBotMessage.created_at);
    if (botMessageTime > customerMessageTime) {
      return null; // Bot/human already responded
    }
  }

  // Calculate wait time in seconds
  const now = new Date();
  const waitTimeMs = now.getTime() - customerMessageTime.getTime();
  const waitTimeSeconds = Math.floor(waitTimeMs / 1000);

  // Only show if waiting more than 30 seconds
  if (waitTimeSeconds < 30) {
    return null;
  }

  return waitTimeSeconds;
};

/**
 * Format a wait duration compactly using its two largest non-zero units:
 * "45s", "12m 4s", "5h 12m", "3d 4h" (a zero minor unit is dropped: "5m", "2d").
 * The unit letters match the dashboard.timeAgo strings, which are identical in
 * every locale, so the result is safe to interpolate into translated sentences.
 */
export const formatWaitTime = (waitTimeSeconds: number): string => {
  const total = Math.max(0, Math.floor(waitTimeSeconds));
  const units: Array<[number, string]> = [
    [Math.floor(total / 86400), "d"],
    [Math.floor((total % 86400) / 3600), "h"],
    [Math.floor((total % 3600) / 60), "m"],
    [total % 60, "s"],
  ];

  const majorIndex = units.findIndex(([value]) => value > 0);
  if (majorIndex === -1) return "0s";

  const [majorValue, majorUnit] = units[majorIndex];
  const minor = units[majorIndex + 1];
  if (!minor || minor[0] === 0) return `${majorValue}${majorUnit}`;
  return `${majorValue}${majorUnit} ${minor[0]}${minor[1]}`;
};

/**
 * Get Tailwind CSS class based on wait time
 * Used for background color coding in tables
 */
export const getWaitTimeClass = (waitTimeSeconds: number | null): string => {
  if (!waitTimeSeconds) return "";

  if (waitTimeSeconds >= 120) {
    return "conversation-waiting-critical";
  } else if (waitTimeSeconds >= 60) {
    return "conversation-waiting-urgent";
  } else if (waitTimeSeconds >= 30) {
    return "conversation-waiting-warning";
  }

  return "";
};

/**
 * Get Badge variant based on wait time
 * Used for badge color coding in widgets
 */
export const getWaitTimeBadgeVariant = (
  waitTimeSeconds: number | null,
): "default" | "secondary" | "destructive" | "outline" => {
  if (!waitTimeSeconds) return "default";

  if (waitTimeSeconds >= 120) {
    return "destructive"; // Red for critical
  } else if (waitTimeSeconds >= 60) {
    return "destructive"; // Also red/orange for urgent
  } else if (waitTimeSeconds >= 30) {
    return "secondary"; // Yellow/gray for warning
  }

  return "default";
};

/**
 * Get user's full name from user object
 */
export const getFullName = (user: {
  first_name?: string;
  last_name?: string;
  email?: string;
}): string => {
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  } else if (user.first_name) {
    return user.first_name;
  } else if (user.email) {
    return user.email.split("@")[0];
  }
  return "Unknown User";
};

/**
 * Text colour for how long a hand-off has waited for a human. Thresholds are
 * minutes, not seconds like getWaitTimeClass: a person picking up a hand-off
 * is slower than an AI reply, so the alarm starts later.
 */
export const getHandoffWaitClass = (waitTimeSeconds: number): string => {
  if (waitTimeSeconds >= 10 * 60) return "text-destructive-700";
  if (waitTimeSeconds >= 3 * 60) return "text-amber-700";
  return "text-neutral-muted";
};
