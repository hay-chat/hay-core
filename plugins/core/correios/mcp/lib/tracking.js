/**
 * Pure tracking logic: code validation and the agent-facing shape of an SRO
 * Rastro object (field names from https://api.correios.com.br/srorastro/v3/api-docs).
 */

const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { staleTracking } = require("@hay/plugin-sdk/stale-tracking");
const { toIso } = require("./dates");

const MAX_EVENTS = 20;
/** Where a customer can follow the parcel themselves (www.correios.com.br/rastreamento redirects here). */
const PUBLIC_TRACKING_URL = "https://rastreamento.correios.com.br/app/index.php";

const CODE_FORMAT = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * Normalise what the customer typed (spaces, dots, hyphens, lower case) to the
 * 13-character code, or refuse with BAD_INPUT.
 */
function normalizeTrackingCode(input) {
  const code = String(input ?? "")
    .toUpperCase()
    .replace(/[\s.\-]/g, "");
  if (!CODE_FORMAT.test(code)) {
    throw toolError(
      "BAD_INPUT",
      "That is not a Correios tracking code. A code has 13 characters: 2 letters, 9 digits, " +
        "2 letters (e.g. AA123456789BR). Ask the customer to check it.",
      { details: { received: String(input ?? "").slice(0, 40) } },
    );
  }
  return code;
}

/**
 * Since the 2025 security change, API Rastro only returns objects posted under
 * the contract of the credentials in use (announced on
 * https://www.correios.com.br/atendimento/developers, "API Rastro: Agora com
 * mais segurança nas informações de rastreamento").
 */
function notFound(code, correiosMessage) {
  return toolError(
    "NOT_FOUND",
    `Correios returned no tracking for ${code}. The Correios API only shows parcels posted ` +
      "under this store's own Correios contract, so this happens when the code is mistyped, " +
      "the parcel has not been posted yet, or it was posted by someone else (a marketplace, " +
      "another seller, or a different contract of the store). Ask the customer to check the " +
      `code; they can also look it up at ${PUBLIC_TRACKING_URL}. Do not say the parcel is lost.`,
    {
      details: {
        trackingCode: code,
        publicTrackingUrl: PUBLIC_TRACKING_URL,
        ...(correiosMessage ? { correiosMessage } : {}),
      },
    },
  );
}

/** "Unidade de Tratamento, CURITIBA/PR" from an SRO `Unidade` / `Destino`. */
function describeUnit(unit) {
  if (!unit || typeof unit !== "object") return null;
  const address = unit.endereco || {};
  const city = [address.cidade, address.uf].filter(Boolean).join("/");
  const parts = [unit.nome || unit.tipo, city, address.pais].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// TODO(verify): event codes are not in the public OpenAPI document. BDE/BDI/BDR
// with tipo "01" as "delivered" comes from the legacy SRO XML manual ("objetos
// com eventos BDE, BDI e BDR e status 01 estão com a trilha encerrada"); OEC
// (out for delivery) and LDI (awaiting pickup) are the commonly documented
// codes. Check all three against real responses. The description match keeps a
// delivered parcel from reading as "in transit" if the codes differ.
const DELIVERED_CODES = new Set(["BDE", "BDI", "BDR"]);
const DELIVERED_TEXT = /^objeto entregue ao destinat/i;

function eventStatus(event) {
  const code = String(event.codigo || "").toUpperCase();
  if (
    (DELIVERED_CODES.has(code) && String(event.tipo) === "01") ||
    DELIVERED_TEXT.test(event.descricao || "")
  ) {
    return "delivered";
  }
  if (code === "OEC") return "out_for_delivery";
  if (code === "LDI") return "awaiting_pickup";
  return "in_transit";
}

function mapEvent(event) {
  const out = {
    timestamp: toIso(event.dtHrCriado),
    description: event.descricao || null,
    detail: event.detalhe || null,
    location: describeUnit(event.unidade),
    destination: describeUnit(event.unidadeDestino),
    code: event.codigo || null,
    type: event.tipo || null,
    status: eventStatus(event),
  };
  const pickupDeadline = toIso(event.dtLimiteRetirada);
  if (pickupDeadline) out.pickupDeadline = pickupDeadline;
  return out;
}

const time = (iso) => (iso ? new Date(iso).getTime() : 0);

function summarize(result) {
  const last = result.lastEvent;
  const where = [last.location, last.destination ? `to ${last.destination}` : null]
    .filter(Boolean)
    .join(" ");
  let text =
    `${result.trackingCode}${result.service ? ` (${result.service})` : ""}: ` +
    `"${last.description || "no description"}"` +
    `${where ? ` at ${where}` : ""}${last.timestamp ? ` on ${last.timestamp}` : ""}.`;
  if (result.delivered) {
    text += ` Delivered${result.deliveredAt ? ` on ${result.deliveredAt}` : ""}.`;
  } else if (result.tracking.isStale) {
    text +=
      ` No movement for ${result.tracking.daysSinceLastUpdate} days (the store's limit is ` +
      `${result.tracking.thresholdDays}): tell the customer honestly and hand off to the store ` +
      "team so they can open an inquiry with Correios.";
  } else if (result.expectedDeliveryAt) {
    text += ` Correios expects delivery by ${result.expectedDeliveryAt}.`;
  }
  return text;
}

/**
 * The tool result for one tracking code from the raw SRO response.
 * Recipient and sender data in the response is left out on purpose: anyone who
 * has a tracking code can ask, so the result carries no personal data.
 *
 * @param {string} code - normalised tracking code
 * @param {object|null} sro - `{ objetos: [...] }`, or null for a 404
 * @param {{ now?: Date|number }} [options]
 */
function buildTracking(code, sro, { now = Date.now() } = {}) {
  const objects = Array.isArray(sro?.objetos) ? sro.objetos : [];
  const object = objects.find((o) => o?.codObjeto === code) || objects[0];
  const rawEvents = Array.isArray(object?.eventos) ? object.eventos : [];
  // Correios reports an unknown object as `mensagem` on the object, with no events.
  if (!rawEvents.length) throw notFound(code, object?.mensagem || null);

  const events = rawEvents.map(mapEvent).sort((a, b) => time(b.timestamp) - time(a.timestamp));
  const lastEvent = events[0];
  const firstEvent = events[events.length - 1];
  const deliveredEvent = events.find((e) => e.status === "delivered") || null;
  const delivered = Boolean(deliveredEvent);

  const result = {
    trackingCode: code,
    service: object.tipoPostal?.categoria || object.tipoPostal?.nome || null,
    status: delivered ? "delivered" : lastEvent.status,
    statusDescription: lastEvent.description,
    delivered,
    deliveredAt: deliveredEvent?.timestamp ?? null,
    expectedDeliveryAt: toIso(object.dtPrevista),
    lastEvent,
    eventCount: events.length,
    events: events.slice(0, MAX_EVENTS),
    // D6-9: no carrier movement for longer than the store's threshold. The
    // first event stands in for "shipped" (tracking starts at posting).
    tracking: staleTracking({
      shippedAt: firstEvent.timestamp,
      lastEventAt: lastEvent.timestamp,
      deliveredAt: deliveredEvent ? deliveredEvent.timestamp || lastEvent.timestamp : null,
      now,
    }),
    publicTrackingUrl: PUBLIC_TRACKING_URL,
  };
  result.summary = summarize(result);
  return result;
}

module.exports = {
  normalizeTrackingCode,
  buildTracking,
  mapEvent,
  eventStatus,
  PUBLIC_TRACKING_URL,
  MAX_EVENTS,
};
