import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Records fetched by id from a tenant-scoped route are looked up together with
 * the caller's organization, so another organization's record reads as missing.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const RECORD_ID = "33333333-3333-4333-8333-333333333333";

type Stored = { id: string; organizationId: string };
let stored: Stored;
const scopedLookup = (id: string, organizationId: string) =>
  Promise.resolve(stored.id === id && stored.organizationId === organizationId ? stored : null);

const mockJobLookup = jest.fn(scopedLookup);
const mockJobUpdate = jest.fn(async () => stored);
jest.mock("@server/repositories/job.repository", () => ({
  jobRepository: {
    findByIdAndOrganization: (id: string, organizationId: string) =>
      mockJobLookup(id, organizationId),
    update: () => mockJobUpdate(),
  },
}));
jest.mock("@server/services/docs-audit.service", () => ({ docsAuditService: {} }));
jest.mock("@server/services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));

const mockFeedbackLookup = jest.fn(scopedLookup);
const mockFeedbackDelete = jest.fn(async () => true);
jest.mock("@server/repositories/message-feedback.repository", () => ({
  MessageFeedbackRepository: jest.fn().mockImplementation(() => ({
    findByIdAndOrganization: (id: string, organizationId: string) =>
      mockFeedbackLookup(id, organizationId),
    delete: () => mockFeedbackDelete(),
  })),
}));
jest.mock("@server/services/insights/feedback-insight.service", () => ({
  feedbackInsightService: {},
  findRatedMessage: jest.fn(),
}));

import { docsAuditRouter } from "@server/routes/v1/docs-audit";
import { messageFeedbackRouter } from "@server/routes/v1/message-feedback";
import { jobQueueService } from "@server/services/job-queue.service";
import type { Context } from "@server/trpc/context";

const ctx = {
  user: { id: "user-1", hasScope: () => true, getRole: () => "owner" },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context;

beforeEach(() => {
  jest.clearAllMocks();
  stored = { id: RECORD_ID, organizationId: ORG_ID };
});

describe("docs audit results", () => {
  it("returns the caller's own job", async () => {
    const result = await docsAuditRouter.createCaller(ctx).getResult({ jobId: RECORD_ID });
    expect(result.id).toBe(RECORD_ID);
    expect(mockJobLookup).toHaveBeenCalledWith(RECORD_ID, ORG_ID);
  });

  it("treats another organization's job as missing", async () => {
    stored.organizationId = OTHER_ORG_ID;
    await expect(docsAuditRouter.createCaller(ctx).getResult({ jobId: RECORD_ID })).rejects.toThrow(
      "Audit job not found",
    );
  });
});

describe("message feedback", () => {
  it("returns the caller's own feedback", async () => {
    const result = await messageFeedbackRouter.createCaller(ctx).get({ id: RECORD_ID });
    expect(result).toEqual(stored);
    expect(mockFeedbackLookup).toHaveBeenCalledWith(RECORD_ID, ORG_ID);
  });

  it("does not delete another organization's feedback", async () => {
    stored.organizationId = OTHER_ORG_ID;
    await expect(messageFeedbackRouter.createCaller(ctx).delete({ id: RECORD_ID })).rejects.toThrow(
      "Feedback not found",
    );
    expect(mockFeedbackDelete).not.toHaveBeenCalled();
  });
});

describe("job queue", () => {
  it("does not cancel another organization's job", async () => {
    stored.organizationId = OTHER_ORG_ID;
    await expect(jobQueueService.cancelJob(RECORD_ID, ORG_ID)).resolves.toBeNull();
    expect(mockJobUpdate).not.toHaveBeenCalled();
  });
});
