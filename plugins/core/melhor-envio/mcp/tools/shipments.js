/**
 * Shipment tools — the "where is my order" playbook. Read-only.
 *
 *   melhorenvio_track_shipment            GET /orders/{id} or GET /orders/search (by code)
 *   melhorenvio_find_customer_shipments   GET /orders/search (by recipient CPF/CNPJ)
 *
 * TODO: quoting freight, buying/generating/cancelling labels and webhooks are out
 * of scope for this plugin's first slice.
 */

const { z } = require("zod");
const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { callerIdentity, ownsRecord, NOT_VERIFIED } = require("@hay/plugin-sdk/identity");
const { handle } = require("../lib/format");
const {
  MAX_RESULTS,
  shapeShipment,
  parseReferences,
  cleanDocument,
  findByReference,
  findRecipientOrders,
  byNewest,
} = require("../lib/shipments");

const DATES_NOTE =
  "Dates are as Melhor Envio reports them (Brasília time). Carrier scan events are not in the " +
  "API: share trackingUrl for those.";

function registerShipmentTools(server) {
  server.tool(
    "melhorenvio_track_shipment",
    "Track a Melhor Envio shipment by the carrier tracking code, the Melhor Envio protocol " +
      "(ORD-...) or the shipment id. Returns status and stage (awaiting_payment, label_paid, " +
      "awaiting_posting, dropped_off, in_transit, delivered, not_delivered, action_required, " +
      "suspended, canceled, expired), carrier and service, tracking code and link, posting and " +
      "delivery dates, the carrier's delivery estimate, and tracking.isStale when a posted " +
      "parcel has gone too long without delivery. " +
      DATES_NOTE,
    {
      reference: z
        .string()
        .describe(
          "Tracking code (e.g. ME220021P96BR), Melhor Envio protocol (e.g. ORD-20220395517) or " +
            "shipment id (UUID). Up to 5, separated by commas.",
        ),
    },
    handle(async ({ reference }) => {
      const references = parseReferences(reference);
      const found = await Promise.all(references.map(findByReference));

      const seen = new Set();
      const orders = found.flat().filter((order) => !seen.has(order.id) && seen.add(order.id));
      const notFound = references.filter((_, i) => !found[i].length);

      if (!orders.length) {
        throw toolError(
          "NOT_FOUND",
          `No Melhor Envio shipment matches ${references.join(", ")}. Ask the customer to check ` +
            "the code against their shipping email; a carrier code can take up to one business " +
            "day after posting to appear. With their CPF or CNPJ, " +
            "melhorenvio_find_customer_shipments can look their shipments up instead.",
          { details: { notFound } },
        );
      }

      const shipments = orders.sort(byNewest).slice(0, MAX_RESULTS).map(shapeShipment);
      return {
        shipments,
        ...(notFound.length ? { notFound } : {}),
        summary:
          shipments.map((s) => s.summary).join(" | ") +
          (notFound.length ? ` | Not found: ${notFound.join(", ")}.` : ""),
      };
    }),
  );

  server.tool(
    "melhorenvio_find_customer_shipments",
    "Find the shipments sent to a customer by their CPF or CNPJ, most recent first, when they " +
      "do not have a tracking code. Melhor Envio cannot search by name or email. Works only " +
      "for the verified customer of the conversation and returns only their own shipments, " +
      "each in the same shape as melhorenvio_track_shipment. " +
      DATES_NOTE,
    {
      document: z
        .string()
        .describe(
          "The recipient's CPF or CNPJ, with or without punctuation (e.g. 123.456.789-09).",
        ),
    },
    handle(async ({ document }, extra) => {
      const identity = callerIdentity(extra);
      if (identity.trust === "none") throw toolError("PRECONDITION", NOT_VERIFIED);
      const cleaned = cleanDocument(document);

      // Customer data: staff see any recipient's shipments, a verified customer
      // only those whose recipient email or phone is theirs.
      const orders = (await findRecipientOrders(cleaned)).filter((order) =>
        ownsRecord(identity, { emails: [order.to?.email], phones: [order.to?.phone] }),
      );

      if (!orders.length) {
        throw toolError(
          "NOT_FOUND",
          "No Melhor Envio shipment was found for this customer with that CPF/CNPJ. Ask for the " +
            "tracking code from their shipping email and use melhorenvio_track_shipment, or " +
            "confirm the document used on the order.",
        );
      }

      const shipments = orders.sort(byNewest).slice(0, MAX_RESULTS).map(shapeShipment);
      const more = orders.length - shipments.length;
      return {
        shipments,
        summary:
          `Found ${orders.length} shipment${orders.length === 1 ? "" : "s"} for this customer` +
          (more > 0 ? ` (showing the ${shipments.length} most recent)` : "") +
          `. Most recent: ${shipments[0].summary}`,
      };
    }),
  );
}

module.exports = { registerShipmentTools };
