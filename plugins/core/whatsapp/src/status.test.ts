import { describe, expect, it } from "vitest";
import { getChannelStatus, paymentSettingsUrl } from "./status.js";
import { GraphClient } from "./graph-client.js";
import type { WhatsAppConnection } from "./connection.js";
import { fakeLogger, queuedFetch } from "./test/fakes.js";

const connection: WhatsAppConnection = { mode: "embedded-signup", accessToken: "t", phoneNumberId: "1", wabaId: "2" };

function ctx(responses: Array<[number, unknown]>, current: WhatsAppConnection | null) {
  const fetch = queuedFetch(responses);
  return {
    getConnection: () => current,
    graph: new GraphClient({ logger: fakeLogger(), fetchImpl: fetch.impl }),
    api: { mutation: async () => ({}) as never },
    logger: fakeLogger(),
  };
}

const settings = { mode: "embedded-signup" as const, appId: "app", configId: "cfg" };

describe("getChannelStatus", () => {
  it("reports not connected with the signup settings", async () => {
    expect(await getChannelStatus(ctx([], null), settings)).toEqual({
      mode: "embedded-signup",
      connected: false,
      embeddedSignup: { appId: "app", configId: "cfg" },
    });
  });

  it("reports health and a missing payment method with the WhatsApp Manager link", async () => {
    const status = await getChannelStatus(
      ctx(
        [
          [200, { id: "1", display_phone_number: "+1 555-0100", health_status: { can_send_message: "LIMITED" } }],
          [200, { id: "2", name: "Acme", owner_business_info: { id: "99" } }],
        ],
        connection,
      ),
      settings,
    );

    expect(status.connected).toBe(true);
    expect(status.phone?.health_status?.can_send_message).toBe("LIMITED");
    expect(status.waba).toEqual({ id: "2", name: "Acme", hasPaymentMethod: false, businessId: "99" });
    expect(status.paymentSettingsUrl).toBe(paymentSettingsUrl("2", "99"));
  });

  it("does not leak the token and degrades on Graph errors", async () => {
    const status = await getChannelStatus(
      ctx([[400, { error: { message: "boom", code: 100 } }], [200, {}]], connection),
      settings,
    );

    expect(status).toMatchObject({ connected: true, error: "boom" });
    expect(JSON.stringify(status)).not.toContain('"t"');
  });
});

describe("paymentSettingsUrl", () => {
  it("deep-links the WABA's WhatsApp settings tab in Business Settings", () => {
    expect(paymentSettingsUrl("123", "456")).toBe(
      "https://business.facebook.com/settings/whatsapp-business-accounts/123?business_id=456&tab=whatsapp_settings",
    );
  });
});
