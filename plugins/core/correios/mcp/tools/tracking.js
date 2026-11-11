/**
 * Tracking tool.
 *
 *   correios_track_shipment  POST /token/v1/autentica/…  (cached)
 *                            GET  /srorastro/v1/objetos/{code}?resultado=T
 *
 * TODO: price and delivery-time quotes, pre-posting, reverse logistics and
 * tracking webhooks are out of scope for this first version.
 */

const { z } = require("zod");
const { toolErrorResult } = require("@hay/plugin-sdk/tool-errors");
const { fetchTracking } = require("../lib/client");
const { normalizeTrackingCode, buildTracking } = require("../lib/tracking");

const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });

const ok = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });

function registerTrackingTools(server) {
  server.registerTool(
    "correios_track_shipment",
    {
      description:
        "Track a Correios shipment by its tracking code. Returns the current status " +
        "(in_transit, out_for_delivery, awaiting_pickup or delivered), the latest event " +
        "(description, location, time), the event history, the delivery date when delivered, " +
        "Correios' expected delivery date, and whether the parcel has stopped moving " +
        "(tracking.isStale). Event descriptions are in Portuguese as Correios wrote them. Only " +
        "parcels posted under the store's own Correios contract can be tracked; for any other " +
        "code the tool answers NOT_FOUND and says what to tell the customer.",
      inputSchema: {
        tracking_code: z
          .string()
          .describe(
            "The 13-character Correios tracking code: 2 letters, 9 digits, 2 letters, e.g. " +
              "'AA123456789BR'. Spaces, hyphens and lower case are accepted.",
          ),
      },
      annotations: READ,
    },
    async ({ tracking_code }) => {
      try {
        const code = normalizeTrackingCode(tracking_code);
        return ok(buildTracking(code, await fetchTracking(code)));
      } catch (err) {
        return toolErrorResult(err);
      }
    },
  );
}

module.exports = { registerTrackingTools };
