import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

const findEnabledByOrganization = jest.fn<(orgId: string) => Promise<unknown[]>>();
const getOrStartWorker = jest.fn<(orgId: string, pluginId: string) => Promise<{ port: number }>>();

jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findEnabledByOrganization },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getOrStartWorker },
}));
jest.mock("@server/lib/config-resolver", () => {
  const actual = jest.requireActual<typeof import("@server/lib/config-resolver")>(
    "@server/lib/config-resolver",
  );
  return {
    ...actual,
    // Instance configs in these tests are plain (not encrypted).
    resolveConfigForWorker: (dbConfig: Record<string, unknown> | undefined) => dbConfig ?? {},
  };
});

import {
  webchatExtensionsService,
  resolveContributionProps,
} from "@server/services/webchat/webchat-extensions.service";
import type { ConfigFieldDescriptor } from "@server/types/plugin-sdk.types";

const schema: Record<string, ConfigFieldDescriptor> = {
  siteKey: { type: "string", label: "Site key", env: "TEST_SITE_KEY" },
  secretKey: { type: "string", label: "Secret", encrypted: true },
  mode: { type: "string", label: "Mode", default: "invisible" },
};

function instance(
  pluginId: string,
  config: Record<string, unknown>,
  webchat: unknown,
  capabilities = ["webchat"],
) {
  return {
    organizationId: "org-1",
    config,
    authState: null,
    plugin: {
      pluginId,
      manifest: { capabilities },
      metadataState: "fresh",
      metadata: { configSchema: schema, webchat },
    },
  };
}

const challenge = {
  contributions: [
    {
      id: "challenge",
      type: "challenge@1",
      props: { provider: "turnstile" },
      configProps: { siteKey: "siteKey", mode: "mode", secret: "secretKey" },
    },
  ],
  gates: [],
};

describe("resolveContributionProps", () => {
  it("resolves env fallbacks and defaults but never encrypted fields", () => {
    process.env.TEST_SITE_KEY = "1x00000000000000000000AA";
    const props = resolveContributionProps(
      challenge.contributions[0],
      { secretKey: "should-not-leak" },
      schema,
      new Set(["TEST_SITE_KEY"]),
    );
    expect(props).toEqual({
      provider: "turnstile",
      siteKey: "1x00000000000000000000AA",
      mode: "invisible",
      secret: undefined,
    });
    delete process.env.TEST_SITE_KEY;
  });
});

describe("webchat contributions", () => {
  beforeEach(() => findEnabledByOrganization.mockReset());

  describe("cart@1", () => {
    const cart = (props: Record<string, unknown>, configProps: Record<string, string> = {}) => ({
      contributions: [{ id: "cart", type: "cart@1", props, configProps }],
      gates: [],
    });
    const valid = {
      addPath: "/cart/add.js",
      addBody: '{"items":[{"id":{{cartItemId}},"quantity":{{quantity}}}]}',
      checkoutPath: "/checkout",
    };
    const served = () =>
      webchatExtensionsService.getPublicContributions("org-1", ["cart@1"], { underAttack: false });

    it("serves the plugin's cart requests, tagged with its catalog source", async () => {
      findEnabledByOrganization.mockResolvedValue([instance("store", {}, cart(valid))]);
      expect(await served()).toEqual([
        { id: "store.cart", type: "cart@1", source: "store", props: valid },
      ]);
    });

    it("is withdrawn when the org switched it off", async () => {
      findEnabledByOrganization.mockResolvedValue([
        instance("store", { mode: false }, cart(valid, { enabled: "mode" })),
      ]);
      expect(await served()).toEqual([]);
    });

    it("refuses a path on another host", async () => {
      for (const addPath of ["//evil.test/cart", "https://evil.test/cart", "cart/add.js"]) {
        findEnabledByOrganization.mockResolvedValue([
          instance("store", {}, cart({ ...valid, addPath })),
        ]);
        expect(await served()).toEqual([]);
      }
    });

    it("refuses a body that is not a JSON template", async () => {
      findEnabledByOrganization.mockResolvedValue([
        instance("store", {}, cart({ ...valid, addBody: "id={{cartItemId}}" })),
      ]);
      expect(await served()).toEqual([]);
    });

    it("refuses half a token setup", async () => {
      findEnabledByOrganization.mockResolvedValue([
        instance("store", {}, cart({ ...valid, tokenPath: "/api/cart" })),
      ]);
      expect(await served()).toEqual([]);
    });

    it("accepts theme events and a storefront root, and refuses malformed ones", async () => {
      const afterAddEvents = JSON.stringify([
        { name: "cart:refresh" },
        { name: "store:sync", target: "window", detail: { type: "from_data" } },
      ]);
      const extras = { afterAddEvents, rootPathGlobal: "Store.routes.root" };
      findEnabledByOrganization.mockResolvedValue([
        instance("store", {}, cart({ ...valid, ...extras })),
      ]);
      expect((await served())[0].props).toMatchObject(extras);

      for (const bad of [
        { afterAddEvents: "cart:refresh,other" },
        { afterAddEvents: JSON.stringify([{ name: "x", target: "document.cookie" }]) },
        { afterAddEvents: JSON.stringify([{ name: "x", detail: { nested: { a: 1 } } }]) },
        { rootPathGlobal: "document.cookie;alert(1)" },
      ]) {
        findEnabledByOrganization.mockResolvedValue([
          instance("store", {}, cart({ ...valid, ...bad })),
        ]);
        expect(await served()).toEqual([]);
      }
    });

    it("is not sent to a widget that cannot use it", async () => {
      findEnabledByOrganization.mockResolvedValue([instance("store", {}, cart(valid))]);
      expect(
        await webchatExtensionsService.getPublicContributions("org-1", ["challenge@1"], {
          underAttack: false,
        }),
      ).toEqual([]);
    });
  });

  it("serves challenge@1 only to widgets that support it", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("captcha", { siteKey: "k" }, challenge)]);

    expect(
      await webchatExtensionsService.getPublicContributions("org-1", [], { underAttack: false }),
    ).toEqual([]);
    expect(
      await webchatExtensionsService.getPublicContributions("org-1", ["challenge@1"], {
        underAttack: false,
      }),
    ).toEqual([
      {
        id: "captcha.challenge",
        type: "challenge@1",
        props: { provider: "turnstile", mode: "invisible" },
      },
    ]);
  });

  it("drops the contribution when the site key is missing (feature unavailable)", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("captcha", {}, challenge)]);
    expect(
      await webchatExtensionsService.resolveChallenges("org-1", { underAttack: false }),
    ).toEqual([]);
  });

  it("skips mode off, but under-attack mode forces challenge_all", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("captcha", { siteKey: "k", mode: "off" }, challenge),
    ]);
    expect(
      await webchatExtensionsService.resolveChallenges("org-1", { underAttack: false }),
    ).toEqual([]);
    const [forced] = await webchatExtensionsService.resolveChallenges("org-1", {
      underAttack: true,
    });
    expect(forced.props.mode).toBe("challenge_all");
  });

  it("ignores plugins without the webchat capability", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("other", { siteKey: "k" }, challenge, ["mcp"]),
    ]);
    expect(
      await webchatExtensionsService.resolveChallenges("org-1", { underAttack: false }),
    ).toEqual([]);
  });
});

describe("webchat gates", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const realFetch = global.fetch;
  const input = { frameHostname: "api.hay.test", underAttack: false };
  const gates = (failurePolicy: "open" | "closed") => ({
    contributions: [],
    gates: [{ event: "conversation.create", timeoutMs: 3000, failurePolicy }],
  });

  beforeEach(() => {
    findEnabledByOrganization.mockReset();
    getOrStartWorker.mockReset().mockResolvedValue({ port: 5555 });
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("allows when no plugin registers a gate", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("captcha", {}, challenge)]);
    const outcome = await webchatExtensionsService.runGates("org-1", "conversation.create", input);
    expect(outcome).toEqual({ decision: "allow", results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the worst decision across plugins (deny > flag > allow)", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("a", {}, gates("open")),
      instance("b", {}, gates("open")),
    ]);
    fetchMock
      .mockResolvedValueOnce(reply({ decision: "flag", reason: "no_token" }))
      .mockResolvedValueOnce(reply({ decision: "deny", reason: "invalid_token" }));

    const outcome = await webchatExtensionsService.runGates("org-1", "conversation.create", {
      ...input,
      token: "t",
    });
    expect(outcome.decision).toBe("deny");
    expect(outcome.results.map((r) => r.reason)).toEqual(["no_token", "invalid_token"]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:5555/webchat/gate/conversation.create");
    expect(JSON.parse(String(init?.body)).input).toMatchObject({
      token: "t",
      event: "conversation.create",
    });
  });

  it("fails open as a flag when the worker errors", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("a", {}, gates("open"))]);
    fetchMock.mockResolvedValueOnce(reply({ error: "boom" }, 500));
    const outcome = await webchatExtensionsService.runGates("org-1", "conversation.create", input);
    expect(outcome).toEqual({
      decision: "flag",
      results: [{ pluginId: "a", decision: "flag", reason: "gate_unavailable" }],
    });
  });

  it("denies when a gate cannot run while the org is under attack", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("a", {}, gates("open"))]);
    fetchMock.mockResolvedValueOnce(reply({ error: "boom" }, 500));
    const outcome = await webchatExtensionsService.runGates("org-1", "conversation.create", {
      ...input,
      underAttack: true,
    });
    expect(outcome.decision).toBe("deny");
  });

  it("fails closed as a deny when the plugin asks for it", async () => {
    findEnabledByOrganization.mockResolvedValue([instance("a", {}, gates("closed"))]);
    getOrStartWorker.mockRejectedValueOnce(new Error("cannot start"));
    const outcome = await webchatExtensionsService.runGates("org-1", "conversation.create", input);
    expect(outcome.decision).toBe("deny");
  });
});
