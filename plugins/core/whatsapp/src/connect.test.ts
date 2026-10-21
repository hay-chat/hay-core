import { describe, expect, it, vi } from "vitest";
import { connectEmbeddedSignup, registerManualRoutes } from "./connect.js";
import { GraphClient } from "./graph-client.js";
import { fakeLogger, queuedFetch } from "./test/fakes.js";

const PHONE = "976350592236691";
const WABA = "1234567890";
const numbers = {
  data: [{ id: PHONE, display_phone_number: "+1 555-0100", verified_name: "Acme" }],
};

function run(
  responses: Array<[number, unknown]>,
  extras: Record<string, unknown> | undefined,
  previous?: Record<string, unknown>,
) {
  const fetch = queuedFetch(responses);
  const graph = new GraphClient({ logger: fakeLogger(), fetchImpl: fetch.impl });
  const result = connectEmbeddedSignup({
    accessToken: "biz-token",
    extras,
    previous,
    graph,
    logger: fakeLogger(),
    generatePin: () => "123456",
  });
  return { result, calls: fetch.calls };
}

describe("connectEmbeddedSignup", () => {
  it("verifies the signup ids, subscribes, registers and returns routing keys + credentials", async () => {
    const { result, calls } = run(
      [
        [200, numbers],
        [200, { success: true }],
        [200, { is_on_biz_app: false, platform_type: "CLOUD_API" }],
        [200, { success: true }],
      ],
      { waba_id: WABA, phone_number_id: PHONE, business_id: "777" },
    );

    expect(await result).toEqual({
      routingKeys: [PHONE, WABA],
      account: { label: "Acme (+1 555-0100)" },
      credentials: {
        phoneNumberId: PHONE,
        wabaId: WABA,
        businessId: "777",
        registrationPin: "123456",
      },
      connection: {
        mode: "embedded-signup",
        accessToken: "biz-token",
        phoneNumberId: PHONE,
        wabaId: WABA,
        businessId: "777",
      },
    });
    expect(calls.map((c) => `${c.init?.method} ${new URL(c.url).pathname}`)).toEqual([
      `GET /v26.0/${WABA}/phone_numbers`,
      `POST /v26.0/${WABA}/subscribed_apps`,
      `GET /v26.0/${PHONE}`,
      `POST /v26.0/${PHONE}/register`,
    ]);
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({
      messaging_product: "whatsapp",
      pin: "123456",
    });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer biz-token",
    );
  });

  it("refuses a phone number that is not on the WABA the token can see", async () => {
    const { result, calls } = run([[200, { data: [{ id: "999" }] }]], {
      waba_id: WABA,
      phone_number_id: PHONE,
    });

    expect(await result).toEqual({ routingKeys: [], connection: null });
    expect(calls).toHaveLength(1);
  });

  it("refuses non-numeric or missing ids without calling Meta", async () => {
    const { result, calls } = run([], { waba_id: "../me", phone_number_id: PHONE });

    expect(await result).toEqual({ routingKeys: [], connection: null });
    expect(calls).toHaveLength(0);
  });

  it("is not routable when Meta rejects the token", async () => {
    const { result } = run(
      [[400, { error: { message: "Invalid OAuth access token", code: 190 } }]],
      {
        waba_id: WABA,
        phone_number_id: PHONE,
      },
    );

    expect((await result).routingKeys).toEqual([]);
  });

  it("skips /register for coexistence numbers", async () => {
    const { result, calls } = run(
      [
        [200, numbers],
        [200, { success: true }],
        [200, { is_on_biz_app: true, platform_type: "CLOUD_API" }],
      ],
      { waba_id: WABA, phone_number_id: PHONE },
    );

    const connected = await result;
    expect(connected.routingKeys).toEqual([PHONE, WABA]);
    expect(connected.credentials).toEqual({ phoneNumberId: PHONE, wabaId: WABA });
    expect(calls).toHaveLength(3);
  });

  it("sets the PIN and retries when /register is refused", async () => {
    const { result, calls } = run(
      [
        [200, numbers],
        [200, { success: true }],
        [200, { is_on_biz_app: false }],
        [400, { error: { message: "PIN mismatch", code: 133005 } }],
        [200, { success: true }],
        [200, { success: true }],
      ],
      { waba_id: WABA, phone_number_id: PHONE },
    );

    expect((await result).routingKeys).toEqual([PHONE, WABA]);
    expect(calls.slice(3).map((c) => new URL(c.url).pathname)).toEqual([
      `/v26.0/${PHONE}/register`,
      `/v26.0/${PHONE}`,
      `/v26.0/${PHONE}/register`,
    ]);
  });

  it("reuses the stored PIN and ids on reconnect without extras", async () => {
    const { result } = run(
      [
        [200, numbers],
        [200, { success: true }],
        [200, { is_on_biz_app: false }],
        [200, { success: true }],
      ],
      undefined,
      { phoneNumberId: PHONE, wabaId: WABA, registrationPin: "654321" },
    );

    expect((await result).credentials?.registrationPin).toBe("654321");
  });
});

describe("registerManualRoutes", () => {
  const manual = {
    mode: "manual" as const,
    accessToken: "pasted",
    phoneNumberId: PHONE,
    wabaId: WABA,
  };

  function deps(responses: Array<[number, unknown]>) {
    const fetch = queuedFetch(responses);
    const mutation = vi.fn(async () => ({ routingKeyCount: 2 }) as never);
    return {
      deps: {
        graph: new GraphClient({ logger: fakeLogger(), fetchImpl: fetch.impl }),
        api: { mutation },
        logger: fakeLogger(),
      },
      mutation,
    };
  }

  it("claims the phone number and WABA once the token can see the number", async () => {
    const { deps: d, mutation } = deps([[200, numbers]]);

    expect(await registerManualRoutes(manual, d)).toBe(true);
    expect(mutation).toHaveBeenCalledWith("webhooks.setRoutingKeys", {
      routingKeys: [PHONE, WABA],
    });
  });

  it("claims nothing for a number the token cannot see, or when Meta rejects the token", async () => {
    const other = deps([[200, { data: [{ id: "999" }] }]]);
    expect(await registerManualRoutes(manual, other.deps)).toBe(false);
    expect(other.mutation).not.toHaveBeenCalled();

    const rejected = deps([[400, { error: { message: "Invalid OAuth access token", code: 190 } }]]);
    expect(await registerManualRoutes(manual, rejected.deps)).toBe(false);
    expect(rejected.mutation).not.toHaveBeenCalled();
  });
});
