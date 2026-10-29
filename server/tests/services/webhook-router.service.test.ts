const findByPluginId = jest.fn();
const findByPlugin = jest.fn();
const startPluginWorker = jest.fn();
const getPlugin = jest.fn();
const findByKey = jest.fn();
const updateActivityTimestamp = jest.fn();

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByPlugin },
}));
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: { findByKey },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { startPluginWorker, getPlugin },
}));
jest.mock("@server/services/plugin-instance-manager.service", () => ({
  pluginInstanceManagerService: { updateActivityTimestamp },
}));
jest.mock("@server/services/plugin-route.service", () => ({
  verifyHmacSha256: jest.fn(),
}));

import {
  webhookRouterService,
  __webhookRouterInternals,
} from "../../services/webhook-router.service";

const routing = { strategy: "shared" };

describe("webhookRouterService.getRoutingDescriptor", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns the cached descriptor without starting a worker when metadata is fresh", async () => {
    findByPluginId.mockResolvedValue({
      id: "reg-1",
      metadataState: "fresh",
      metadata: { webhookRouting: routing },
    });

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBe(routing);
    expect(startPluginWorker).not.toHaveBeenCalled();
  });

  it("refreshes stale metadata through an enabled org's worker", async () => {
    findByPluginId.mockResolvedValue({ id: "reg-1", metadataState: "stale", metadata: {} });
    findByPlugin.mockResolvedValue([
      { organizationId: "org-off", enabled: false },
      { organizationId: "org-on", enabled: true },
    ]);
    getPlugin.mockReturnValue({ metadataState: "fresh", metadata: { webhookRouting: routing } });

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBe(routing);
    expect(startPluginWorker).toHaveBeenCalledWith("org-on", "p");
  });

  it("falls back to cached metadata when no org has the plugin enabled", async () => {
    findByPluginId.mockResolvedValue({
      id: "reg-1",
      metadataState: "missing",
      metadata: undefined,
    });
    findByPlugin.mockResolvedValue([]);
    getPlugin.mockReturnValue(undefined);

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBeNull();
    expect(startPluginWorker).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispatch (shared-webhook fan-out)
// ---------------------------------------------------------------------------

type RouteKeyPath = {
  itemsPath: string;
  keyPath: string;
  keyTransform?: "email-address";
  nested?: { itemsPath: string; keyPath: string };
};

type Dispatch = (
  pluginId: string,
  routing: { routeKeyPath: RouteKeyPath },
  body: Record<string, unknown>,
  req: unknown,
) => Promise<void>;

const dispatch: Dispatch = (pluginId, routingDescriptor, body, req) =>
  (webhookRouterService as unknown as { dispatch: Dispatch }).dispatch(
    pluginId,
    routingDescriptor,
    body,
    req,
  );

const fakeReq = {
  headers: {},
  get: () => "host",
  protocol: "https",
  originalUrl: "/v1/plugins/p/webhook",
};

const instagramRouting = { routeKeyPath: { itemsPath: "entry", keyPath: "id" } };
const whatsappRouting = {
  routeKeyPath: {
    itemsPath: "entry",
    keyPath: "id",
    nested: { itemsPath: "changes", keyPath: "value.metadata.phone_number_id" },
  },
};

/** Build a WhatsApp `messages` change for the given phone number id. */
function messagesChange(phoneNumberId: string, messageId: string) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "1", phone_number_id: phoneNumberId },
      messages: [{ id: messageId }],
    },
  };
}

function whatsappBody(entry: unknown[]) {
  return { object: "whatsapp_business_account", entry };
}

/** Map routing keys to their owning org for `findByKey`. */
function setOwners(owners: Record<string, string>) {
  findByKey.mockImplementation(async (_pluginId: string, key: string) =>
    owners[key] ? { organizationId: owners[key], pluginInstanceId: `inst-${owners[key]}` } : null,
  );
}

/** Collect the bodies forwarded to workers, keyed by the org that was started. */
function forwardedBodies(): Record<string, Record<string, unknown>> {
  const fetchMock = global.fetch as jest.Mock;
  const result: Record<string, Record<string, unknown>> = {};
  fetchMock.mock.calls.forEach((call, index) => {
    const organizationId = startPluginWorker.mock.calls[index][0] as string;
    result[organizationId] = JSON.parse(call[1].body as string);
  });
  return result;
}

describe("webhookRouterService.dispatch", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    startPluginWorker.mockResolvedValue({ port: 1234, instanceId: "inst" });
    updateActivityTimestamp.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  it("routes whole entries by entry.id when no nested descriptor is declared", async () => {
    setOwners({ IG1: "org-a", IG2: "org-b" });
    const entryA = { id: "IG1", messaging: [{ text: "a" }] };
    const entryB = { id: "IG2", messaging: [{ text: "b" }] };

    await dispatch(
      "p",
      instagramRouting,
      { object: "instagram", entry: [entryA, entryB] },
      fakeReq,
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const bodies = forwardedBodies();
    expect(bodies["org-a"]).toEqual({ object: "instagram", entry: [entryA] });
    expect(bodies["org-b"]).toEqual({ object: "instagram", entry: [entryB] });
  });

  it("routes a WhatsApp change by its nested phone_number_id", async () => {
    setOwners({ WABA1: "org-waba", PN1: "org-a" });
    const body = whatsappBody([{ id: "WABA1", changes: [messagesChange("PN1", "wamid.1")] }]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(startPluginWorker).toHaveBeenCalledTimes(1);
    expect(startPluginWorker).toHaveBeenCalledWith("org-a", "p");
    expect(forwardedBodies()["org-a"]).toEqual(body);
  });

  it("splits one entry's changes between two orgs without mutating the original body", async () => {
    setOwners({ WABA1: "org-waba", PN1: "org-a", PN2: "org-b" });
    const changeA = messagesChange("PN1", "wamid.1");
    const changeB = messagesChange("PN2", "wamid.2");
    const body = whatsappBody([{ id: "WABA1", changes: [changeA, changeB] }]);
    const snapshot = JSON.parse(JSON.stringify(body));

    await dispatch("p", whatsappRouting, body, fakeReq);

    const bodies = forwardedBodies();
    expect(Object.keys(bodies).sort()).toEqual(["org-a", "org-b"]);
    expect(bodies["org-a"]).toEqual(whatsappBody([{ id: "WABA1", changes: [changeA] }]));
    expect(bodies["org-b"]).toEqual(whatsappBody([{ id: "WABA1", changes: [changeB] }]));
    expect(body).toEqual(snapshot);
  });

  it("routes an account_update change (no phone_number_id) by entry.id", async () => {
    setOwners({ WABA1: "org-waba", PN1: "org-a" });
    const accountUpdate = { field: "account_update", value: { event: "VERIFIED_ACCOUNT" } };
    const body = whatsappBody([{ id: "WABA1", changes: [accountUpdate] }]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(startPluginWorker).toHaveBeenCalledTimes(1);
    expect(forwardedBodies()["org-waba"]).toEqual(body);
  });

  it("drops a change with an unknown phone_number_id instead of sending it to the WABA owner", async () => {
    setOwners({ WABA1: "org-waba" });
    const body = whatsappBody([
      { id: "WABA1", changes: [messagesChange("PN-unknown", "wamid.1")] },
    ]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(startPluginWorker).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends exactly one copy when the same org owns entry.id and phone_number_id", async () => {
    setOwners({ WABA1: "org-a", PN1: "org-a" });
    const accountUpdate = { field: "account_update", value: { event: "VERIFIED_ACCOUNT" } };
    const change = messagesChange("PN1", "wamid.1");
    const body = whatsappBody([{ id: "WABA1", changes: [change, accountUpdate] }]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(forwardedBodies()["org-a"]).toEqual(
      whatsappBody([{ id: "WABA1", changes: [change, accountUpdate] }]),
    );
  });

  it("falls back to item-level routing when the item has no nested array", async () => {
    setOwners({ WABA1: "org-waba" });
    const body = whatsappBody([{ id: "WABA1", time: 123 }]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(startPluginWorker).toHaveBeenCalledWith("org-waba", "p");
    expect(forwardedBodies()["org-waba"]).toEqual(body);
  });

  it("looks up each distinct routing key once per dispatch", async () => {
    setOwners({ WABA1: "org-waba", PN1: "org-a" });
    const body = whatsappBody([
      {
        id: "WABA1",
        changes: [messagesChange("PN1", "wamid.1"), messagesChange("PN1", "wamid.2")],
      },
      { id: "WABA1", changes: [messagesChange("PN1", "wamid.3")] },
    ]);

    await dispatch("p", whatsappRouting, body, fakeReq);

    expect(findByKey).toHaveBeenCalledTimes(2);
    expect(findByKey).toHaveBeenCalledWith("p", "WABA1");
    expect(findByKey).toHaveBeenCalledWith("p", "PN1");
  });
});

describe("webhookRouterService.dispatch (single-object body)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    startPluginWorker.mockResolvedValue({ port: 1234, instanceId: "inst" });
    updateActivityTimestamp.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  const rootRouting = { routeKeyPath: { itemsPath: ".", keyPath: "store_id" } };

  it("routes the whole body by a top-level key and forwards it unchanged", async () => {
    setOwners({ "789": "org-store" });
    const body = { store_id: 789, customer: { id: 1 }, orders_to_redact: [1, 2] };

    await dispatch("p", rootRouting, body, fakeReq);

    expect(findByKey).toHaveBeenCalledWith("p", "789");
    expect(forwardedBodies()["org-store"]).toEqual(body);
  });

  it("drops a body whose key has no owner", async () => {
    setOwners({});
    await dispatch("p", rootRouting, { store_id: 1 }, fakeReq);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("webhookRouterService.dispatch (email-address keys)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    startPluginWorker.mockResolvedValue({ port: 1234, instanceId: "inst" });
    updateActivityTimestamp.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  const emailRouting = {
    routeKeyPath: { itemsPath: "data.to", keyPath: ".", keyTransform: "email-address" as const },
  };

  it("routes a plain string array by the normalised address and forwards only that org's recipients", async () => {
    setOwners({ "in-acme@inbound.hay.chat": "org-acme" });
    const body = {
      type: "email.received",
      data: {
        email_id: "e1",
        to: ['"Acme" <In-Acme+c42@Inbound.hay.chat>', "someone@else.com"],
      },
    };

    await dispatch("p", emailRouting, body, fakeReq);

    expect(findByKey).toHaveBeenCalledWith("p", "in-acme@inbound.hay.chat");
    const bodies = forwardedBodies();
    expect(bodies["org-acme"]).toEqual({
      type: "email.received",
      data: { email_id: "e1", to: ['"Acme" <In-Acme+c42@Inbound.hay.chat>'] },
    });
  });

  it("drops recipients that are not addresses without a lookup", async () => {
    setOwners({});
    await dispatch("p", emailRouting, { data: { to: ["garbage"] } }, fakeReq);
    expect(findByKey).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("webhookRouterService.handle signature formats", () => {
  const svixSecretBytes = Buffer.from("0123456789abcdef0123456789abcdef");
  const svixSecret = `whsec_${svixSecretBytes.toString("base64")}`;
  const rawBody = '{"type":"email.received","data":{"to":["x@y.z"]}}';

  function makeRes() {
    const res: { statusCode?: number; body?: unknown; status: jest.Mock; json: jest.Mock } = {
      status: jest.fn(),
      json: jest.fn(),
    };
    res.status.mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json.mockImplementation((payload: unknown) => {
      res.body = payload;
      return res;
    });
    return res;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TEST_SVIX_SECRET = svixSecret;
    findByKey.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.TEST_SVIX_SECRET;
  });

  const svixRouting = {
    signature: { header: "svix-signature", format: "svix" as const, secretEnv: "TEST_SVIX_SECRET" },
    routeKeyPath: { itemsPath: "data.to", keyPath: "." },
  };

  function svixHeaders(ts: number, body: string, key: Buffer = svixSecretBytes) {
    const sig = require("crypto")
      .createHmac("sha256", key)
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    return { "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
  }

  it("accepts a correctly signed svix request and acks 200", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const req = { method: "POST", headers: svixHeaders(ts, rawBody), rawBody } as never;
    const res = makeRes();

    await webhookRouterService.handle(req, res as never, "p", svixRouting as never);

    expect(res.statusCode).toBe(200);
  });

  it("rejects a svix request signed with another secret", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const req = {
      method: "POST",
      headers: svixHeaders(ts, rawBody, Buffer.from("another-secret-another-secret!!")),
      rawBody,
    } as never;
    const res = makeRes();

    await webhookRouterService.handle(req, res as never, "p", svixRouting as never);

    expect(res.statusCode).toBe(401);
  });
});

describe("__webhookRouterInternals", () => {
  const { getPath, withPath, routingKey } = __webhookRouterInternals;

  it("routingKey treats '.' as the item itself and applies the email transform", () => {
    expect(routingKey("A@B.com", ".", undefined)).toBe("A@B.com");
    expect(routingKey("A@B.com", ".", "email-address")).toBe("a@b.com");
    expect(routingKey({ id: 7 }, "id", undefined)).toBe("7");
    expect(routingKey({ id: null }, "id", undefined)).toBeUndefined();
  });

  it("getPath walks dot-paths and returns undefined for missing segments", () => {
    const source = { a: { b: { c: 1 } }, list: [1] };
    expect(getPath(source, "a.b.c")).toBe(1);
    expect(getPath(source, "a.x.c")).toBeUndefined();
    expect(getPath(source, "list.0")).toBe(1);
    expect(getPath(null, "a")).toBeUndefined();
  });

  it("withPath returns a copy with the value set and leaves the input untouched", () => {
    const source = { id: "x", meta: { keep: true, changes: [1, 2] } };
    const snapshot = JSON.parse(JSON.stringify(source));

    const copy = withPath(source, "meta.changes", [1]);

    expect(copy).toEqual({ id: "x", meta: { keep: true, changes: [1] } });
    expect(source).toEqual(snapshot);
    expect(copy.meta).not.toBe(source.meta);
    expect(withPath({ a: 1 }, "b.c", 2)).toEqual({ a: 1, b: { c: 2 } });
  });
});
