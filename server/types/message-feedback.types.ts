export enum FeedbackRating {
  GOOD = "good",
  BAD = "bad",
  NEUTRAL = "neutral",
}

/**
 * Who gave a rating: a team member reviewing an AI reply in the dashboard, or
 * the visitor rating an AI answer in the webchat widget (thumbs up/down).
 */
export enum FeedbackSource {
  OPERATOR = "operator",
  VISITOR = "visitor",
}

export enum DeliveryState {
  QUEUED = "queued",
  SENT = "sent",
  BLOCKED = "blocked",
}

export interface CreateFeedbackInput {
  messageId: string;
  rating: FeedbackRating;
  comment?: string;
}

export interface FeedbackFilter {
  messageId?: string;
  rating?: FeedbackRating;
  source?: FeedbackSource;
  startDate?: Date;
  endDate?: Date;
  reviewerId?: string;
}
