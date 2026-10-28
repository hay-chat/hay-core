/**
 * Pix block (D10-2): read the Pix copy-paste code, QR image link and expiry that
 * Brazilian gateway plugins store in order meta, from an ALLOWLIST of keys only.
 * Nothing else from meta_data is ever returned (it can hold gateway secrets).
 *
 * Key sources (D10 research, plugin source unless noted):
 * - Mercado Pago:    mp_pix_qr_code (copy-paste). The image is base64 (mp_pix_qr_base64),
 *                    too large to pass on, so qrImageUrl stays null.
 * - PagBank:         _pagbank_pix_text, _pagbank_pix_qr_code, _pagbank_pix_expiration_date
 * - PagBank Connect: pix_qrcode_text, pix_qrcode, pix_qrcode_expiration
 * - Pagar.me:        UNVERIFIED key; the plugin keeps the API response (charges →
 *                    last_transaction.qr_code / qr_code_url / expires_at) in order meta.
 * - Asaas:           UNVERIFIED key; the plugin keeps the payment object (pixQrCode
 *                    payload / expirationDate) in order meta.
 * The unverified keys need confirming on a live store with each plugin installed.
 */

const PROVIDERS = [
  {
    provider: "mercadopago",
    copyPaste: ["mp_pix_qr_code", "_mp_pix_qr_code"],
    qrImageUrl: [],
    expiresAt: [],
  },
  {
    provider: "pagbank",
    copyPaste: ["_pagbank_pix_text"],
    qrImageUrl: ["_pagbank_pix_qr_code"],
    expiresAt: ["_pagbank_pix_expiration_date"],
  },
  {
    provider: "pagbank_connect",
    copyPaste: ["pix_qrcode_text"],
    qrImageUrl: ["pix_qrcode"],
    expiresAt: ["pix_qrcode_expiration"],
  },
  // Blob providers: one meta value holds the gateway's response object.
  {
    provider: "pagarme",
    blob: ["_pagarme_response_data", "pagarme_response_data"],
    copyPaste: ["qr_code"],
    qrImageUrl: ["qr_code_url"],
    expiresAt: ["expires_at"],
  },
  {
    provider: "asaas",
    blob: ["__ASAAS_ORDER", "_asaas_payment", "asaas_payment"],
    copyPaste: ["payload"],
    qrImageUrl: [],
    expiresAt: ["expirationDate"],
  },
];

const MAX_DEPTH = 6;

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** First non-empty string under any of `keys`, searched depth-first in a blob. */
function deepFind(node, keys, depth = 0) {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  for (const key of keys) {
    const v = node[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const child of Object.values(node)) {
    const found = deepFind(parseMaybeJson(child), keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function text(value) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A Pix EMV payload always starts with the "000201" payload-format header. */
function looksLikePixCode(value) {
  return typeof value === "string" && /^000201/.test(value) && value.length >= 50;
}

function httpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

const NAIVE_LOCAL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;

/**
 * The expiry as `{ expiresAt, expiresAtIsLocal }`. A zoned string or epoch
 * seconds/ms becomes a UTC ISO string. A WordPress "Y-m-d H:i:s" without a zone
 * is the store's local time: it is returned as "Y-m-dTH:i:s" unchanged and
 * flagged local, because parsing it would apply this server's zone instead.
 */
function expiry(value) {
  const none = { expiresAt: null, expiresAtIsLocal: false };
  if (value === null || value === undefined || value === "") return none;
  const raw = String(value).trim();
  const local = NAIVE_LOCAL.exec(raw);
  if (local) return { expiresAt: `${local[1]}T${local[2]}`, expiresAtIsLocal: true };
  let date;
  if (typeof value === "number" || /^\d+$/.test(raw)) {
    const n = Number(raw);
    date = new Date(n < 1e12 ? n * 1000 : n);
  } else {
    date = new Date(raw);
  }
  return Number.isNaN(date.getTime())
    ? none
    : { expiresAt: date.toISOString(), expiresAtIsLocal: false };
}

/** @returns {{provider, copyPaste, qrImageUrl, expiresAt, expiresAtIsLocal} | null} */
function parsePix(metaData) {
  const meta = new Map();
  for (const m of metaData || []) {
    if (m && typeof m.key === "string" && !meta.has(m.key)) meta.set(m.key, m.value);
  }
  for (const spec of PROVIDERS) {
    let pick;
    if (spec.blob) {
      const blobKey = spec.blob.find((k) => meta.has(k));
      if (!blobKey) continue;
      const blob = parseMaybeJson(meta.get(blobKey));
      pick = (keys) => (keys.length ? deepFind(blob, keys) : null);
    } else {
      pick = (keys) => {
        const key = keys.find((k) => meta.has(k));
        return key ? text(meta.get(key)) : null;
      };
    }
    const copyPaste = pick(spec.copyPaste);
    if (!looksLikePixCode(copyPaste)) continue;
    return {
      provider: spec.provider,
      copyPaste,
      qrImageUrl: httpUrl(pick(spec.qrImageUrl)),
      ...expiry(pick(spec.expiresAt)),
    };
  }
  return null;
}

module.exports = { parsePix, PIX_PROVIDERS: PROVIDERS.map((p) => p.provider) };
