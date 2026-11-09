import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/services/redis.service", () => ({ redisService: {} }));
jest.mock("@server/repositories/job.repository", () => ({ jobRepository: {} }));

import { JobQueueService } from "@server/services/job-queue.service";

type Internals = { claimNextBackgroundJob: () => Promise<null> };

const withClaim = (claim: () => Promise<null>) => {
  const service = new JobQueueService();
  (service as unknown as Internals).claimNextBackgroundJob = claim;
  return service;
};

describe("JobQueueService shutdown", () => {
  it("waits for the running job and claims no more", async () => {
    let finish = (): void => undefined;
    const claim = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          finish = () => resolve(null);
        }),
    );
    const service = withClaim(claim);
    const running = service.processNextJob();

    let stopped = false;
    const shutdown = service.shutdown(5000).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);

    finish();
    await Promise.all([running, shutdown]);
    expect(stopped).toBe(true);

    await service.processNextJob();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("stops waiting at the timeout", async () => {
    const service = withClaim(() => new Promise<null>(() => undefined));
    void service.processNextJob();

    await expect(service.shutdown(10)).resolves.toBeUndefined();
  });
});
