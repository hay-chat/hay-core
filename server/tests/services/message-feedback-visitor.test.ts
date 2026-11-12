import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Visitor feedback (C3): the widget's thumbs up/down on an AI answer is kept
 * in message_feedback as source "visitor", with no reviewer. Only AI answers
 * of the visitor's own conversation can be rated, and rating again replaces
 * the earlier rating (and its insight issue).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

class FakeMessageFeedback {}
class FakeInsightIssue {}
jest.mock("@server/database/entities/message-feedback.entity", () => ({
  MessageFeedback: FakeMessageFeedback,
}));
jest.mock("@server/database/entities/insight-issue.entity", () => ({
  InsightIssue: FakeInsightIssue,
}));

const feedbackRepo = {
  find: jest.fn<(options: unknown) => Promise<Array<{ id: string }>>>(async () => []),
  delete: jest.fn<(criteria: unknown) => Promise<void>>(async () => undefined),
  create: jest.fn((data: Record<string, unknown>) => data),
  save: jest.fn(async (row: Record<string, unknown>) => ({ id: "fb-new", ...row })),
};
const issueRepo = { delete: jest.fn<(criteria: unknown) => Promise<void>>(async () => undefined) };
const manager = {
  getRepository: (entity: unknown) => (entity === FakeInsightIssue ? issueRepo : feedbackRepo),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    isInitialized: false,
    getRepository: () => ({}),
    transaction: async (run: (m: typeof manager) => Promise<unknown>) => run(manager),
  },
}));

const mockFindRatedMessage = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCreatePendingIssue = jest.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
jest.mock("@server/services/insights/feedback-insight.service", () => ({
  findRatedMessage: (...args: unknown[]) => mockFindRatedMessage(...args),
  feedbackInsightService: {
    createPendingIssue: (...args: unknown[]) => mockCreatePendingIssue(...args),
  },
}));

import {
  FeedbackMessageNotFoundError,
  MessageFeedbackService,
} from "@server/services/message-feedback.service";

const conversation = { id: "conv-1", organization_id: "org-1" };

const rated = (overrides: Record<string, unknown> = {}) => ({
  message: { id: "m1", type: "BotAgent", deliveryState: "sent", ...overrides },
  conversation: { id: "conv-1", metadata: null },
});

describe("MessageFeedbackService.rateAsVisitor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    feedbackRepo.find.mockResolvedValue([]);
  });

  it("stores a thumbs up as visitor feedback with no reviewer", async () => {
    mockFindRatedMessage.mockResolvedValue(rated());

    const feedback = await new MessageFeedbackService().rateAsVisitor(conversation, "m1", "up");

    expect(mockFindRatedMessage).toHaveBeenCalledWith("org-1", "m1", manager);
    expect(feedbackRepo.save).toHaveBeenCalledWith({
      messageId: "m1",
      organizationId: "org-1",
      reviewerId: null,
      source: "visitor",
      rating: "good",
      comment: null,
    });
    expect(mockCreatePendingIssue).toHaveBeenCalledWith(feedback, rated(), manager);
  });

  it("rating again replaces the earlier rating and its insight issue", async () => {
    mockFindRatedMessage.mockResolvedValue(rated());
    feedbackRepo.find.mockResolvedValue([{ id: "fb-old" }]);

    await new MessageFeedbackService().rateAsVisitor(conversation, "m1", "down");

    expect(feedbackRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { messageId: "m1", source: "visitor" } }),
    );
    expect(issueRepo.delete).toHaveBeenCalled();
    expect(feedbackRepo.delete).toHaveBeenCalled();
    expect(feedbackRepo.save).toHaveBeenCalledWith(expect.objectContaining({ rating: "bad" }));
  });

  it.each([
    ["a message of another conversation", { conversation: { id: "conv-2" } }],
    ["a visitor message", { message: { id: "m1", type: "Customer", deliveryState: "sent" } }],
    [
      "an answer still held for approval",
      { message: { id: "m1", type: "BotAgent", deliveryState: "queued" } },
    ],
  ])("refuses %s", async (_label, overrides) => {
    mockFindRatedMessage.mockResolvedValue({ ...rated(), ...overrides });

    await expect(
      new MessageFeedbackService().rateAsVisitor(conversation, "m1", "up"),
    ).rejects.toBeInstanceOf(FeedbackMessageNotFoundError);
    expect(feedbackRepo.save).not.toHaveBeenCalled();
  });

  it("refuses a message of another organization", async () => {
    mockFindRatedMessage.mockResolvedValue(null);
    await expect(
      new MessageFeedbackService().rateAsVisitor(conversation, "m1", "up"),
    ).rejects.toBeInstanceOf(FeedbackMessageNotFoundError);
  });
});
