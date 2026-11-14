/**
 * A document source sync that hit its time budget with work left is queued
 * again right away instead of waiting for the 60 s dispatcher.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

const mockProcessSyncJob = jest.fn();
const mockEnqueueSync = jest.fn();

jest.mock("@server/services/redis.service", () => ({ redisService: {} }));
jest.mock("@server/repositories/job.repository", () => ({ jobRepository: {} }));
jest.mock("@server/services/document-source-sync.service", () => ({
  documentSourceSyncService: {
    processSyncJob: (...args: unknown[]) => mockProcessSyncJob(...args),
    enqueueSync: (...args: unknown[]) => mockEnqueueSync(...args),
  },
}));

import type { Job } from "@server/entities/job.entity";
import { JobQueueService } from "@server/services/job-queue.service";

type Internals = {
  dispatchBackgroundJob: (job: Job) => Promise<void>;
  completeJob: (...args: unknown[]) => Promise<null>;
};

const syncJob = {
  id: "job-1",
  organizationId: "org-1",
  data: { type: "document_source_sync", documentSourceId: "src-1" },
} as unknown as Job;

function dispatch(): { run: Promise<void>; completeJob: jest.Mock } {
  const service = new JobQueueService() as unknown as Internals;
  const completeJob = jest.fn(async () => null);
  service.completeJob = completeJob;
  return { run: service.dispatchBackgroundJob(syncJob), completeJob };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueueSync.mockResolvedValue({ jobId: "job-2" });
});

describe("document source sync continuation", () => {
  it("queues the next run after completing a run that asked to continue", async () => {
    mockProcessSyncJob.mockResolvedValue({ continueNow: true });

    const { run, completeJob } = dispatch();
    await run;

    expect(completeJob).toHaveBeenCalledWith("job-1", "org-1", { ok: true });
    expect(mockEnqueueSync).toHaveBeenCalledWith("src-1");
    // Completed first, so enqueueSync doesn't see this job as still in flight.
    expect(completeJob.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueSync.mock.invocationCallOrder[0],
    );
  });

  it("leaves finished runs to the dispatcher", async () => {
    mockProcessSyncJob.mockResolvedValue({ continueNow: false });

    const { run } = dispatch();
    await run;

    expect(mockEnqueueSync).not.toHaveBeenCalled();
  });

  it("does not fail the job when queueing the continuation fails", async () => {
    mockProcessSyncJob.mockResolvedValue({ continueNow: true });
    mockEnqueueSync.mockRejectedValue(new Error("db down"));

    const { run, completeJob } = dispatch();
    await expect(run).resolves.toBeUndefined();
    expect(completeJob).toHaveBeenCalledTimes(1);
  });
});
