export enum FeedbackRating {
  GOOD = "good",
  BAD = "bad",
  NEUTRAL = "neutral",
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
  startDate?: Date;
  endDate?: Date;
  reviewerId?: string;
}
