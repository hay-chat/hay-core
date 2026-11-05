import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockSendToOrganization = jest.fn((_organizationId: string, _message: unknown) => 1);
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToOrganization: mockSendToOrganization },
}));

import {
  createPluginInstallProgress,
  PLUGIN_INSTALL_PROGRESS_EVENT,
} from "@server/lib/plugin-install-progress";

const PROGRESS_ID = "3f1c2b7e-9a4d-4c1e-8b2a-0d6f5e4c3b2a";

// Sends go through a lazily imported websocket service.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const sentStatuses = () =>
  mockSendToOrganization.mock.calls.map(([, message]) => {
    const { payload } = message as { payload: { step: string; status: string } };
    return `${payload.step}:${payload.status}`;
  });

describe("createPluginInstallProgress", () => {
  beforeEach(() => mockSendToOrganization.mockClear());

  it("sends nothing when the client did not ask for progress", async () => {
    const progress = createPluginInstallProgress("org-1", "shopify", undefined);
    progress.mark("install", "skipped");
    await progress.run("build", async () => "ok");
    await flush();
    expect(mockSendToOrganization).not.toHaveBeenCalled();
  });

  it("reports active then done around a step, to the organization", async () => {
    const progress = createPluginInstallProgress("org-1", "shopify", PROGRESS_ID);
    await expect(progress.run("install", async () => 42)).resolves.toBe(42);
    await flush();

    expect(sentStatuses()).toEqual(["install:active", "install:done"]);
    expect(mockSendToOrganization).toHaveBeenCalledWith("org-1", {
      type: PLUGIN_INSTALL_PROGRESS_EVENT,
      payload: { progressId: PROGRESS_ID, pluginId: "shopify", step: "install", status: "done" },
    });
  });

  it("reports failed and rethrows when a step throws", async () => {
    const progress = createPluginInstallProgress("org-1", "shopify", PROGRESS_ID);
    const boom = new Error("tsc exited with code 2");
    await expect(progress.run("build", () => Promise.reject(boom))).rejects.toBe(boom);
    await flush();
    expect(sentStatuses()).toEqual(["build:active", "build:failed"]);
  });
});
