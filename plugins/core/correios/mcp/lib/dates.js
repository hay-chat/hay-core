/**
 * Correios date-times.
 *
 * The OpenAPI specs type them as `date-time` but do not say whether an offset
 * is sent. A value without one is read as Brasília time (UTC-03:00, no DST
 * since 2019); the Token API also returns a `zoneOffset` field for its dates.
 */

// TODO(verify): confirm with a real response that SRO Rastro `dtHrCriado` and
// Token `expiraEm` are local Brasília times without an offset, and the format
// of Token `zoneOffset` (assumed "-03:00").
const BRASILIA_OFFSET = "-03:00";

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

/**
 * ISO string with an explicit offset, or null when the value is not a date.
 *
 * @param {unknown} value
 * @param {unknown} [offset] - used only when `value` carries none
 */
function toIso(value, offset) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const iso = HAS_OFFSET.test(text)
    ? text
    : text + (typeof offset === "string" && OFFSET.test(offset) ? offset : BRASILIA_OFFSET);
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
}

module.exports = { toIso, BRASILIA_OFFSET };
