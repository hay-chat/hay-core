/**
 * Melhor Envio shipments ("orders" / "etiquetas" in their API): lookups plus the
 * pure mapping from their order object to what a support reply needs.
 *
 * Endpoints (docs.melhorenvio.com.br/reference):
 *   GET /api/v2/me/orders/{id}        one shipment by its id (UUID)
 *   GET /api/v2/me/orders/search?q=   matches ONE of: id, protocol, tracking,
 *                                     authorization_code, or a sender/recipient
 *                                     document (CPF/CNPJ). Not name or email.
 *
 * POST /api/v2/me/shipment/tracking is not used: it only takes ids and returns a
 * subset of the fields above (status + lifecycle dates, no carrier or service).
 *
 * The API reports a lifecycle status and its dates, not carrier scan events; the
 * tracking link is where the customer sees those.
 */

const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { staleTracking } = require("@hay/plugin-sdk/stale-tracking");
const { digits } = require("@hay/plugin-sdk/identity");
const { meGet, MelhorEnvioApiError } = require("./client");
const { compact } = require("./format");

const MAX_REFERENCES = 5;
const MAX_RESULTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lifecycle statuses → a stable `stage` and a sentence the agent can relay.
 * Values come from the docs (search filter list, response examples and the
 * `order.<status>` webhook events).
 * TODO(verify): the REST spelling of the cancelled status ("canceled" matches the
 * `canceled_at` field, the webhook event is `order.cancelled`) and whether an
 * "expired" status exists; both spellings and the *_at dates are handled.
 */
const STAGES = {
  pending: {
    stage: "awaiting_payment",
    description: "The shipping label was created but has not been paid; nothing has shipped yet.",
  },
  released: {
    stage: "label_paid",
    description: "The shipping label is paid; the parcel has not been handed to the carrier yet.",
  },
  generated: {
    stage: "awaiting_posting",
    description: "The shipping label is ready; the parcel has not been handed to the carrier yet.",
  },
  received: {
    stage: "dropped_off",
    description: "The parcel was received at a drop-off point and is waiting for the carrier.",
  },
  posted: {
    stage: "in_transit",
    description: "The parcel was handed to the carrier and is on its way.",
  },
  delivered: { stage: "delivered", description: "The parcel was delivered." },
  undelivered: {
    stage: "not_delivered",
    description: "The carrier could not deliver the parcel.",
  },
  paused: {
    stage: "action_required",
    description: "Delivery is on hold and needs an action from the recipient.",
  },
  suspended: { stage: "suspended", description: "The shipment was suspended." },
  canceled: { stage: "canceled", description: "The shipping label was cancelled." },
  cancelled: { stage: "canceled", description: "The shipping label was cancelled." },
  expired: {
    stage: "expired",
    description: "The shipping label expired before the parcel was posted.",
  },
};

/** Fallback for a status this plugin does not know: read the lifecycle dates. */
const DATE_FALLBACKS = [
  ["delivered_at", "delivered"],
  ["canceled_at", "canceled"],
  ["expired_at", "expired"],
  ["suspended_at", "suspended"],
  ["posted_at", "posted"],
  ["generated_at", "generated"],
  ["paid_at", "released"],
];

function stageOf(order) {
  const status = String(order?.status ?? "")
    .trim()
    .toLowerCase();
  if (STAGES[status]) return STAGES[status];
  const dated = DATE_FALLBACKS.find(([field]) => order?.[field]);
  if (dated) return STAGES[dated[1]];
  return {
    stage: "unknown",
    description: status
      ? `Melhor Envio reports the status "${status}".`
      : "Melhor Envio did not report a status for this shipment.",
  };
}

/**
 * REST dates come as "YYYY-MM-DD HH:MM:SS" with no zone.
 * TODO(verify): assumed to be Brasília time (UTC-3, no DST); only used to count
 * days for the stale flag, where a few hours do not matter. Dates are returned to
 * the agent exactly as Melhor Envio sent them.
 */
function toIso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(value.trim());
  if (naive) return `${naive[1]}T${naive[2]}-03:00`;
  return Number.isNaN(Date.parse(value)) ? null : value.trim();
}

/** Uppercase letters and digits only, so "me 220021p96 br" equals "ME220021P96BR". */
const codeKey = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * The public tracking page. The webhook payload carries `tracking_url`
 * (https://www.melhorrastreio.com.br/rastreio/<code>); REST responses are not
 * documented to, so it is rebuilt from the code.
 * TODO(verify): that the page accepts the carrier code for every carrier.
 */
function trackingUrlOf(order, code) {
  if (typeof order.tracking_url === "string" && order.tracking_url.trim()) {
    return order.tracking_url.replace(/\s+/g, "");
  }
  return code ? `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(code)}` : null;
}

function estimateOf(order) {
  const min = Number(order.delivery_min);
  const max = Number(order.delivery_max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  return { min, max };
}

/**
 * Melhor Envio order → the compact shipment a support reply needs. Recipient
 * details are cut to first name and city: enough to confirm "is this yours?"
 * without handing out an address or a document number.
 */
function shapeShipment(order, { now = Date.now() } = {}) {
  const { stage, description } = stageOf(order);
  const trackingCode = order.tracking || order.self_tracking || order.melhorenvio_tracking || null;
  const to = order.to || {};

  const shipment = compact({
    id: order.id,
    protocol: order.protocol,
    status: order.status,
    stage,
    statusDescription: description,
    carrier: order.service?.company?.name,
    service: order.service?.name,
    trackingCode,
    trackingUrl: trackingUrlOf(order, trackingCode),
    // TODO(verify): whether delivery_min/max count business or calendar days.
    estimatedDeliveryDays: estimateOf(order),
    isReturn: order.reverse === true ? true : null,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    generatedAt: order.generated_at,
    postedAt: order.posted_at,
    deliveredAt: order.delivered_at,
    canceledAt: order.canceled_at,
    expiredAt: order.expired_at,
    recipient: compact({
      firstName: typeof to.name === "string" ? to.name.trim().split(/\s+/)[0] : null,
      city: to.city,
      state: to.state_abbr,
    }),
  });

  // Stale flag only while the parcel is with the carrier. With no carrier events
  // in the API, "last update" is the posting date.
  if (stage === "in_transit" && toIso(order.posted_at)) {
    const stale = staleTracking({
      shippedAt: toIso(order.posted_at),
      originCountry: order.from?.country_id,
      destinationCountry: to.country_id,
      now,
    });
    shipment.tracking = {
      isStale: stale.isStale,
      daysSinceLastUpdate: stale.daysSinceLastUpdate,
      thresholdDays: stale.thresholdDays,
      staleReason: stale.staleReason,
    };
  }

  shipment.summary = summarize(shipment);
  return shipment;
}

/** One relayable sentence group per shipment. */
function summarize(s) {
  const what = [s.carrier, s.service].filter(Boolean).join(" ") || "Melhor Envio";
  const code = s.trackingCode || s.protocol;
  const parts = [`${what} shipment${code ? ` ${code}` : ""}: ${s.statusDescription}`];
  if (s.stage === "in_transit") {
    if (s.postedAt) parts.push(`Posted on ${s.postedAt}.`);
    if (s.estimatedDeliveryDays) {
      const { min, max } = s.estimatedDeliveryDays;
      parts.push(`Carrier estimate: ${min === max ? max : `${min} to ${max}`} days after posting.`);
    }
    if (s.tracking?.isStale) {
      parts.push(
        `Not delivered ${s.tracking.daysSinceLastUpdate} days after posting, above the store's ` +
          `${s.tracking.thresholdDays}-day limit: treat it as possibly stuck and escalate to the store.`,
      );
    }
  }
  if (s.stage === "delivered" && s.deliveredAt) parts.push(`Delivered on ${s.deliveredAt}.`);
  if (s.trackingUrl && s.stage !== "canceled" && s.stage !== "expired") {
    parts.push(`Carrier events: ${s.trackingUrl}`);
  }
  return parts.join(" ");
}

/**
 * Split what the agent passed into references: comma, semicolon or whitespace
 * separated tracking codes, protocols or shipment ids.
 */
function parseReferences(raw) {
  const references = [
    ...new Set(
      String(raw ?? "")
        .split(/[\s,;]+/)
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ];
  if (!references.length) {
    throw toolError(
      "BAD_INPUT",
      "Give the tracking code, the Melhor Envio protocol (ORD-...) or the shipment id. Ask the " +
        "customer for the tracking code from their shipping email.",
      { details: { field: "reference" } },
    );
  }
  if (references.length > MAX_REFERENCES) {
    throw toolError(
      "BAD_INPUT",
      `At most ${MAX_REFERENCES} shipments can be tracked per call; call again for the rest.`,
      { details: { field: "reference" } },
    );
  }
  return references;
}

/** CPF (11 digits) or CNPJ (14 digits), with or without punctuation. */
function cleanDocument(raw) {
  const document = digits(raw);
  if (document.length !== 11 && document.length !== 14) {
    throw toolError(
      "BAD_INPUT",
      `"${String(raw ?? "").trim()}" is not a CPF (11 digits) or CNPJ (14 digits). Ask the ` +
        "customer for the CPF or CNPJ used on the order.",
      { details: { field: "document" } },
    );
  }
  return document;
}

/** Search results (an array; empty when Melhor Envio answers "Not Found"). */
async function searchOrders(q) {
  try {
    const found = await meGet("/api/v2/me/orders/search", { q });
    return Array.isArray(found) ? found : [];
  } catch (err) {
    if (err instanceof MelhorEnvioApiError && err.notFound) return [];
    throw err;
  }
}

/**
 * The shipments one reference points at. The search endpoint also matches
 * documents, so results are kept only when the reference is the shipment's own
 * id, protocol, tracking or authorization code: a CPF passed here finds nothing
 * (customer lookups go through findRecipientOrders and its identity check).
 */
async function findByReference(reference) {
  if (UUID.test(reference)) {
    try {
      const order = await meGet(`/api/v2/me/orders/${encodeURIComponent(reference)}`);
      return order && order.id ? [order] : [];
    } catch (err) {
      if (err instanceof MelhorEnvioApiError && err.notFound) return [];
      throw err;
    }
  }
  const key = codeKey(reference);
  if (!key) return [];
  const found = await searchOrders(reference);
  return found.filter((order) =>
    [order.id, order.protocol, order.tracking, order.self_tracking, order.authorization_code].some(
      (value) => value && codeKey(value) === key,
    ),
  );
}

/** Shipments addressed to this CPF/CNPJ (the search also matches senders: dropped). */
async function findRecipientOrders(document) {
  const found = await searchOrders(document);
  return found.filter((order) =>
    [order.to?.document, order.to?.company_document].some((value) => digits(value) === document),
  );
}

/** Newest first. */
function byNewest(a, b) {
  return String(b.created_at || "").localeCompare(String(a.created_at || ""));
}

module.exports = {
  MAX_RESULTS,
  STAGES,
  stageOf,
  toIso,
  shapeShipment,
  parseReferences,
  cleanDocument,
  findByReference,
  findRecipientOrders,
  byNewest,
};
