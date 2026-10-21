import { describe, it, expect, beforeEach, vi } from "vitest";
import { executeOnConnected } from "./hook-executor.js";
import type { HayLogger, HayPluginDefinition, HayConnectedContext } from "../types/index.js";

describe("executeOnConnected", () => {
  let logger: HayLogger;
  let ctx: HayConnectedContext;

  beforeEach(() => {
    logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    ctx = {
      org: { id: "org-1" },
      config: {} as HayConnectedContext["config"],
      auth: {} as HayConnectedContext["auth"],
      logger,
    };
  });

  it("passes extras to onConnected", async () => {
    const onConnected = vi.fn().mockResolvedValue({ routingKeys: ["WABA1"] });
    const plugin = {
      name: "p",
      onInitialize: vi.fn(),
      onConnected,
    } as unknown as HayPluginDefinition;
    const extras = { waba_id: "WABA1", phone_number_id: "PN1" };

    const result = await executeOnConnected(plugin, ctx, logger, extras);

    expect(onConnected).toHaveBeenCalledWith(ctx, extras);
    expect(result.routingKeys).toEqual(["WABA1"]);
  });

  it("omits extras when absent", async () => {
    const onConnected = vi.fn().mockResolvedValue({ routingKeys: [] });
    const plugin = {
      name: "p",
      onInitialize: vi.fn(),
      onConnected,
    } as unknown as HayPluginDefinition;

    await executeOnConnected(plugin, ctx, logger);

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onConnected.mock.calls[0][0]).toBe(ctx);
    expect(onConnected.mock.calls[0][1]).toBeUndefined();
  });

  it("returns account and credentials from onConnected", async () => {
    const plugin = {
      name: "p",
      onInitialize: vi.fn(),
      onConnected: vi.fn().mockResolvedValue({
        routingKeys: ["WABA1"],
        account: { label: "+1 555" },
        credentials: { wabaId: "WABA1", pin: "123456" },
      }),
    } as unknown as HayPluginDefinition;

    const result = await executeOnConnected(plugin, ctx, logger);

    expect(result).toEqual({
      routingKeys: ["WABA1"],
      account: { label: "+1 555" },
      credentials: { wabaId: "WABA1", pin: "123456" },
    });
  });

  it("drops non-object credentials", async () => {
    const plugin = {
      name: "p",
      onInitialize: vi.fn(),
      onConnected: vi.fn().mockResolvedValue({ credentials: ["nope"] }),
    } as unknown as HayPluginDefinition;

    const result = await executeOnConnected(plugin, ctx, logger);

    expect(result.credentials).toBeUndefined();
  });
});
