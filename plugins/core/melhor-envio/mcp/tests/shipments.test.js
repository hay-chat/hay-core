import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  STAGES,
  stageOf,
  toIso,
  shapeShipment,
  parseReferences,
  cleanDocument,
} = require("../lib/shipments");
const { order } = require("./fixtures");

// 3 days after the fixture's posting date.
const SOON = new Date("2022-04-01T21:00:06-03:00");
// 12 days after it.
const LATE = new Date("2022-04-10T21:00:06-03:00");

describe("stageOf", () => {
  it("maps every documented lifecycle status to a stage", () => {
    const stages = Object.fromEntries(
      Object.keys(STAGES).map((status) => [status, stageOf({ status }).stage]),
    );
    expect(stages).toEqual({
      pending: "awaiting_payment",
      released: "label_paid",
      generated: "awaiting_posting",
      received: "dropped_off",
      posted: "in_transit",
      delivered: "delivered",
      undelivered: "not_delivered",
      paused: "action_required",
      suspended: "suspended",
      canceled: "canceled",
      cancelled: "canceled",
      expired: "expired",
    });
  });

  it("ignores case and whitespace", () => {
    expect(stageOf({ status: " Posted " }).stage).toBe("in_transit");
  });

  it("falls back to the lifecycle dates for a status it does not know", () => {
    expect(stageOf({ status: "something_new", delivered_at: "2022-04-02 10:00:00" }).stage).toBe(
      "delivered",
    );
    expect(stageOf({ status: null, posted_at: "2022-03-29 21:00:06" }).stage).toBe("in_transit");
    expect(stageOf({ status: null, paid_at: "2022-03-29 20:43:37" }).stage).toBe("label_paid");
  });

  it("reports an unknown status as unknown instead of guessing", () => {
    expect(stageOf({ status: "something_new" })).toEqual({
      stage: "unknown",
      description: 'Melhor Envio reports the status "something_new".',
    });
    expect(stageOf({}).stage).toBe("unknown");
  });
});

describe("toIso", () => {
  it("reads Melhor Envio's zoneless dates as Brasília time", () => {
    expect(toIso("2022-03-29 21:00:06")).toBe("2022-03-29T21:00:06-03:00");
  });

  it("keeps a date that already has an offset and rejects junk", () => {
    expect(toIso("2024-03-29T23:55:00+00:00")).toBe("2024-03-29T23:55:00+00:00");
    expect(toIso("not a date")).toBeNull();
    expect(toIso(null)).toBeNull();
  });
});

describe("shapeShipment", () => {
  it("returns the fields a where-is-my-order reply needs", () => {
    expect(shapeShipment(order(), { now: SOON })).toEqual({
      id: "34105e98-bb32-4e85-8b0f-8bd2c888eb31",
      protocol: "ORD-20220395517",
      status: "posted",
      stage: "in_transit",
      statusDescription: "The parcel was handed to the carrier and is on its way.",
      carrier: "Correios",
      service: "PAC",
      trackingCode: "ME220021P96BR",
      trackingUrl: "https://www.melhorrastreio.com.br/rastreio/ME220021P96BR",
      estimatedDeliveryDays: { min: 8, max: 9 },
      createdAt: "2022-03-29 20:24:51",
      paidAt: "2022-03-29 20:43:37",
      generatedAt: "2022-03-29 20:43:50",
      postedAt: "2022-03-29 21:00:06",
      recipient: { firstName: "Maria", city: "Nova Iguacu", state: "RJ" },
      tracking: {
        isStale: false,
        daysSinceLastUpdate: 3,
        thresholdDays: 5,
        staleReason: null,
      },
      summary:
        "Correios PAC shipment ME220021P96BR: The parcel was handed to the carrier and is on " +
        "its way. Posted on 2022-03-29 21:00:06. Carrier estimate: 8 to 9 days after posting. " +
        "Carrier events: https://www.melhorrastreio.com.br/rastreio/ME220021P96BR",
    });
  });

  it("never returns the recipient's address, document, phone or email", () => {
    const text = JSON.stringify(shapeShipment(order(), { now: SOON }));
    for (const secret of ["73646548010", "11999990000", "maria@example.com", "Marechal", "Souza"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("flags a posted parcel that passed the stale threshold", () => {
    const s = shapeShipment(order(), { now: LATE });
    expect(s.tracking).toEqual({
      isStale: true,
      daysSinceLastUpdate: 12,
      thresholdDays: 5,
      staleReason: "NOT_DELIVERED_SINCE_SHIPPED",
    });
    expect(s.summary).toMatch(/Not delivered 12 days after posting, above the store's 5-day limit/);
  });

  it("honours the store's threshold from env", () => {
    process.env.STALE_TRACKING_DOMESTIC_DAYS = "15";
    try {
      expect(shapeShipment(order(), { now: LATE }).tracking).toMatchObject({
        isStale: false,
        thresholdDays: 15,
      });
    } finally {
      delete process.env.STALE_TRACKING_DOMESTIC_DAYS;
    }
  });

  it("has no stale flag once delivered, or before posting", () => {
    const delivered = shapeShipment(
      order({ status: "delivered", delivered_at: "2022-04-05 14:10:00" }),
      { now: LATE },
    );
    expect(delivered.tracking).toBeUndefined();
    expect(delivered.deliveredAt).toBe("2022-04-05 14:10:00");
    expect(delivered.summary).toMatch(
      /The parcel was delivered\. Delivered on 2022-04-05 14:10:00/,
    );

    const unposted = shapeShipment(
      order({ status: "released", posted_at: null, generated_at: null, tracking: null }),
      { now: LATE },
    );
    expect(unposted.stage).toBe("label_paid");
    expect(unposted.tracking).toBeUndefined();
    expect(unposted.postedAt).toBeUndefined();
  });

  it("uses the tracking_url Melhor Envio sends when there is one, and no link without a code", () => {
    expect(
      shapeShipment(order({ tracking_url: "https: //www.melhorrastreio.com.br/rastreio/X1" }))
        .trackingUrl,
    ).toBe("https://www.melhorrastreio.com.br/rastreio/X1");

    const noCode = shapeShipment(order({ status: "pending", tracking: null, self_tracking: null }));
    expect(noCode.trackingCode).toBeUndefined();
    expect(noCode.trackingUrl).toBeUndefined();
    expect(noCode.summary).toBe(
      "Correios PAC shipment ORD-20220395517: The shipping label was created but has not been " +
        "paid; nothing has shipped yet.",
    );
  });

  it("marks a reverse-logistics label as a return", () => {
    expect(shapeShipment(order({ reverse: true })).isReturn).toBe(true);
    expect(shapeShipment(order()).isReturn).toBeUndefined();
  });
});

describe("parseReferences", () => {
  it("splits on commas, semicolons and whitespace and drops duplicates", () => {
    expect(parseReferences(" ME1BR, ORD-2;ME1BR\nME3BR ")).toEqual(["ME1BR", "ORD-2", "ME3BR"]);
  });

  it("refuses an empty reference and more than five", () => {
    expect(() => parseReferences("  ")).toThrow(/tracking code/);
    expect(() => parseReferences("a,b,c,d,e,f")).toThrow(/At most 5/);
    try {
      parseReferences("");
    } catch (err) {
      expect(err.code).toBe("BAD_INPUT");
    }
  });
});

describe("cleanDocument", () => {
  it("accepts a CPF or CNPJ with or without punctuation", () => {
    expect(cleanDocument("736.465.480-10")).toBe("73646548010");
    expect(cleanDocument(" 89.794.131/0001-00 ")).toBe("89794131000100");
    expect(cleanDocument("73646548010")).toBe("73646548010");
  });

  it("refuses anything that is not 11 or 14 digits", () => {
    for (const bad of ["", "12345", "maria@example.com", "123456789012"]) {
      expect(() => cleanDocument(bad)).toThrow(/not a CPF/);
    }
  });
});
