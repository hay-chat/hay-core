/**
 * Stale tracking flag (D6-9), shared by the commerce plugins so every
 * supportSummary computes it the same way, deterministically, in the plugin
 * (never by the LLM).
 *
 * A shipment is stale when it has shipped, is not delivered, and nothing has
 * moved for longer than the store's threshold: days since the last carrier event
 * when the platform reports events (Shopify), else days since it shipped.
 * Defaults: 5 days domestic, 10 days international (Roger, D6 answer 4); each
 * store can override both.
 */

const DEFAULT_DOMESTIC_DAYS = 5;
const DEFAULT_INTERNATIONAL_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Thresholds from env (the plugin passes its per-store config through env). */
function thresholdsFromEnv(env = process.env) {
  return {
    domesticDays: positiveInt(env.STALE_TRACKING_DOMESTIC_DAYS, DEFAULT_DOMESTIC_DAYS),
    internationalDays: positiveInt(
      env.STALE_TRACKING_INTERNATIONAL_DAYS,
      DEFAULT_INTERNATIONAL_DAYS,
    ),
  };
}

function time(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function country(code) {
  return typeof code === "string" && code.trim() ? code.trim().slice(0, 2).toUpperCase() : null;
}

/**
 * @param {object} input
 * @param {string|null} input.shippedAt     when the shipment left (ISO)
 * @param {string|null} [input.lastEventAt] latest carrier event (ISO), when known
 * @param {string|null} [input.deliveredAt] delivery confirmation (ISO)
 * @param {string|null} [input.originCountry]      store country (ISO-2)
 * @param {string|null} [input.destinationCountry] shipping country (ISO-2)
 * @param {{domesticDays:number, internationalDays:number}} [input.thresholds]
 * @param {Date|number} [input.now]
 */
function staleTracking(input) {
  const thresholds = input.thresholds || thresholdsFromEnv();
  const origin = country(input.originCountry);
  const destination = country(input.destinationCountry);
  // Unknown countries count as domestic: the shorter threshold flags sooner.
  const international = Boolean(origin && destination && origin !== destination);
  const thresholdDays = international ? thresholds.internationalDays : thresholds.domesticDays;

  const shipped = time(input.shippedAt);
  const lastEvent = time(input.lastEventAt);
  const now = input.now instanceof Date ? input.now.getTime() : (input.now ?? Date.now());
  const lastUpdate = Math.max(shipped ?? 0, lastEvent ?? 0) || null;
  const daysSinceLastUpdate =
    lastUpdate === null ? null : Math.max(0, Math.floor((now - lastUpdate) / DAY_MS));

  let staleReason = null;
  if (!input.deliveredAt && shipped !== null && daysSinceLastUpdate > thresholdDays) {
    staleReason = lastEvent !== null ? "NO_CARRIER_UPDATE" : "NOT_DELIVERED_SINCE_SHIPPED";
  }
  return {
    shippedAt: input.shippedAt || null,
    lastEventAt: input.lastEventAt || null,
    daysSinceLastUpdate,
    international,
    thresholdDays,
    isStale: staleReason !== null,
    staleReason,
  };
}

/** The stalest of several shipments (an order can ship in parts). */
function stalestShipment(results) {
  const list = results.filter(Boolean);
  if (!list.length) return null;
  return list.reduce((worst, r) => {
    if (r.isStale !== worst.isStale) return r.isStale ? r : worst;
    return (r.daysSinceLastUpdate ?? -1) > (worst.daysSinceLastUpdate ?? -1) ? r : worst;
  });
}

module.exports = {
  DEFAULT_DOMESTIC_DAYS,
  DEFAULT_INTERNATIONAL_DAYS,
  thresholdsFromEnv,
  staleTracking,
  stalestShipment,
};
