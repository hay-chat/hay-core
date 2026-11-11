/**
 * Pure tracking logic: code validation and the mapping of an SRO object to the
 * agent-facing result (no HTTP).
 */
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";

const require = createRequire(import.meta.url);
const { makeEvent, makeSro, POSTED, DELIVERED } = require("./fixtures");
const { normalizeTrackingCode, buildTracking, MAX_EVENTS } = require("../lib/tracking");
const { toIso } = require("../lib/dates");

const CODE = "AA123456789BR";
const now = new Date("2026-10-28T12:00:00Z");

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

describe("normalizeTrackingCode", () => {
  it("accepts what customers type: lower case, spaces, hyphens, dots", () => {
    expect(normalizeTrackingCode("AA123456789BR")).toBe(CODE);
    expect(normalizeTrackingCode("  aa 123.456.789-br ")).toBe(CODE);
  });

  it.each(["", "AA12345678BR", "AA1234567890BR", "A1123456789BR", "123456789", "AA123456789B1"])(
    "refuses %j with BAD_INPUT and the expected format",
    (input) => {
      const err = thrown(() => normalizeTrackingCode(input));
      expect(err.code).toBe("BAD_INPUT");
      expect(err.message).toContain("AA123456789BR");
    },
  );
});

describe("toIso", () => {
  it("reads a date without an offset as Brasília time and keeps an explicit offset", () => {
    expect(toIso("2026-10-20T10:00:00")).toBe("2026-10-20T10:00:00-03:00");
    expect(toIso("2026-10-20T10:00:00", "-04:00")).toBe("2026-10-20T10:00:00-04:00");
    expect(toIso("2026-10-20T13:00:00Z")).toBe("2026-10-20T13:00:00Z");
    expect(toIso("2026-10-20T10:00:00-03:00")).toBe("2026-10-20T10:00:00-03:00");
  });

  it("returns null for anything that is not a date", () => {
    expect(toIso(undefined)).toBeNull();
    expect(toIso("")).toBeNull();
    expect(toIso("amanhã")).toBeNull();
  });
});

describe("buildTracking", () => {
  it("maps a parcel in transit: newest event first, location, expected date, summary", () => {
    // Events deliberately oldest-first: the result must not depend on API order.
    const result = buildTracking(CODE, makeSro(CODE, [POSTED, makeEvent()]), {
      now: new Date("2026-10-21T12:00:00Z"),
    });
    expect(result).toMatchObject({
      trackingCode: CODE,
      service: "SEDEX",
      status: "in_transit",
      statusDescription: "Objeto em transferência - por favor aguarde",
      delivered: false,
      deliveredAt: null,
      expectedDeliveryAt: "2026-10-23T23:59:59-03:00",
      eventCount: 2,
      lastEvent: {
        timestamp: "2026-10-20T10:00:00-03:00",
        description: "Objeto em transferência - por favor aguarde",
        location: "Unidade de Tratamento, CURITIBA/PR",
        destination: "Unidade de Distribuição, SAO PAULO/SP",
        code: "RO",
      },
      tracking: { isStale: false, daysSinceLastUpdate: 0, thresholdDays: 5 },
    });
    expect(result.events.map((e) => e.description)).toEqual([
      "Objeto em transferência - por favor aguarde",
      "Objeto postado",
    ]);
    expect(result.events[1].location).toBe("Agência dos Correios, CURITIBA/PR");
    expect(result.summary).toContain(CODE);
    expect(result.summary).toContain("Correios expects delivery by");
  });

  it("flags a delivered parcel with its delivery date, never as stale", () => {
    const result = buildTracking(CODE, makeSro(CODE, [DELIVERED, makeEvent(), POSTED]), { now });
    expect(result).toMatchObject({
      status: "delivered",
      delivered: true,
      deliveredAt: "2026-10-22T14:05:00-03:00",
      tracking: { isStale: false },
    });
    expect(result.summary).toContain("Delivered on 2026-10-22T14:05:00-03:00");
  });

  it("recognises delivery by description when the event code is not a known one", () => {
    const event = { ...DELIVERED, codigo: "XYZ", tipo: "99" };
    expect(buildTracking(CODE, makeSro(CODE, [event, POSTED]), { now }).delivered).toBe(true);
  });

  it("does not read a return to the sender as delivered to the customer", () => {
    const event = makeEvent({
      codigo: "BDE",
      tipo: "23",
      descricao: "Objeto entregue ao remetente",
    });
    expect(buildTracking(CODE, makeSro(CODE, [event, POSTED]), { now }).delivered).toBe(false);
  });

  it("reports out for delivery and awaiting pickup (with the pickup deadline)", () => {
    const out = makeEvent({ codigo: "OEC", descricao: "Objeto saiu para entrega ao destinatário" });
    expect(buildTracking(CODE, makeSro(CODE, [out, POSTED]), { now }).status).toBe(
      "out_for_delivery",
    );
    const pickup = makeEvent({
      codigo: "LDI",
      descricao: "Objeto aguardando retirada no endereço indicado",
      dtLimiteRetirada: "2026-10-30T23:59:59",
    });
    const result = buildTracking(CODE, makeSro(CODE, [pickup, POSTED]), { now });
    expect(result.status).toBe("awaiting_pickup");
    expect(result.lastEvent.pickupDeadline).toBe("2026-10-30T23:59:59-03:00");
  });

  it("flags a parcel with no movement past the threshold as stale, and says to hand off", () => {
    const result = buildTracking(CODE, makeSro(CODE, [makeEvent(), POSTED]), { now });
    expect(result.tracking).toMatchObject({
      isStale: true,
      staleReason: "NO_CARRIER_UPDATE",
      daysSinceLastUpdate: 7,
      thresholdDays: 5,
      shippedAt: "2026-10-15T09:30:00-03:00",
      lastEventAt: "2026-10-20T10:00:00-03:00",
    });
    expect(result.summary).toContain("No movement for 7 days");
    expect(result.summary).toContain("hand off");
  });

  it("caps the history and keeps the total", () => {
    const events = Array.from({ length: MAX_EVENTS + 5 }, (_, i) =>
      makeEvent({ dtHrCriado: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00` }),
    );
    const result = buildTracking(CODE, makeSro(CODE, events), { now });
    expect(result.eventCount).toBe(MAX_EVENTS + 5);
    expect(result.events).toHaveLength(MAX_EVENTS);
    expect(result.events[0].timestamp).toBe("2026-10-25T10:00:00-03:00");
  });

  it("never returns the recipient's personal data", () => {
    const text = JSON.stringify(buildTracking(CODE, makeSro(CODE, [DELIVERED, POSTED]), { now }));
    expect(text).not.toContain("MARIA");
    expect(text).not.toContain("12345678900");
  });

  it.each([
    [
      "an object with a message and no events",
      makeSro(CODE, undefined, {
        mensagem: "SRO-020: Objeto não encontrado na base de dados dos Correios.",
      }),
    ],
    ["an object with an empty event list", makeSro(CODE, [])],
    ["no objects", { objetos: [] }],
    ["a 404 (null)", null],
  ])("answers NOT_FOUND and explains the own-contract rule for %s", (_label, sro) => {
    const err = thrown(() => buildTracking(CODE, sro, { now }));
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain(CODE);
    expect(err.message).toContain("own Correios contract");
    expect(err.message).toContain("Do not say the parcel is lost");
    expect(err.details.publicTrackingUrl).toMatch(/^https:\/\/rastreamento\.correios\.com\.br\//);
  });

  it("passes the Correios message along in the NOT_FOUND details", () => {
    const sro = makeSro(CODE, [], { mensagem: "SRO-020: Objeto não encontrado" });
    expect(thrown(() => buildTracking(CODE, sro, { now })).details.correiosMessage).toBe(
      "SRO-020: Objeto não encontrado",
    );
  });
});
