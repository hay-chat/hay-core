import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const getStaleUnprocessed =
  jest.fn<() => Promise<Array<{ id: string; organization_id: string }>>>();
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({ getStaleUnprocessed })),
}));
const enqueue = jest.fn<(id: string, org: string, trigger: string) => Promise<void>>();
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue },
}));
const mockBroker = { connected: false };
jest.mock("@server/services/rabbitmq.service", () => ({
  rabbitmqService: { isConnected: () => mockBroker.connected },
}));
const processDirectly = jest.fn<(ids: string[]) => Promise<void>>();
jest.mock("@server/workers/orchestrator.worker", () => ({
  orchestratorWorker: { processDirectly },
}));

// The registry's other jobs are not under test; their services are heavy to load.
jest.mock("@server/services/scheduler.service", () => ({ schedulerService: {} }));
jest.mock("@server/services/dpop-cache.service", () => ({ dpopCacheService: {} }));
jest.mock("@server/services/job-queue.service", () => ({ jobQueueService: {} }));
jest.mock("@server/services/privacy.service", () => ({ privacyService: {} }));
jest.mock("@server/services/plugin-instance-manager.service", () => ({
  pluginInstanceManagerService: {},
}));
jest.mock("@server/services/oauth-token-refresh.job", () => ({ refreshOAuthTokens: jest.fn() }));
jest.mock("@server/services/document-retry.service", () => ({ documentRetryService: {} }));

import { getJobConfig } from "@server/services/scheduled-jobs.registry";

describe("orchestrator-sweep", () => {
  const sweep = () => getJobConfig("orchestrator-sweep")!.handler();

  beforeEach(() => {
    jest.clearAllMocks();
    getStaleUnprocessed.mockResolvedValue([{ id: "c1", organization_id: "o1" }]);
  });

  it("processes pending conversations itself while RabbitMQ is down", async () => {
    mockBroker.connected = false;
    await sweep();
    expect(processDirectly).toHaveBeenCalledWith(["c1"]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("re-enqueues them while RabbitMQ is up", async () => {
    mockBroker.connected = true;
    await sweep();
    expect(enqueue).toHaveBeenCalledWith("c1", "o1", "sweep");
    expect(processDirectly).not.toHaveBeenCalled();
  });
});
