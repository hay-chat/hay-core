/**
 * Support tools — the "something is broken" playbook.
 *
 *   spacebring_report_issue  GET membership (optional) → POST ticket
 */

const { z } = require("zod");
const { toolError } = require("@hay/plugin-sdk/tool-errors");
const { sbApi, itemOf } = require("../lib/client");
const { handle, cleanEmail, norm, formatLocal } = require("../lib/format");
const { resolveLocation, findMember } = require("../lib/spacebring");

/** Spacebring ticket types, with the words members use for each. Order matters: first hit wins. */
const TICKET_TYPES = [
  ["internet", ["wifi", "wi fi", "internet", "network", "connection", "ethernet", "rede"]],
  ["printing", ["print", "printer", "scanner", "impressora"]],
  [
    "temperatureAndVentilation",
    [
      "ac",
      "air con",
      "aircon",
      "air conditioning",
      "heating",
      "hot",
      "cold",
      "temperature",
      "ventilation",
      "ar condicionado",
    ],
  ],
  [
    "access",
    ["door", "access", "key", "card", "badge", "lock", "entry", "locked out", "porta", "acesso"],
  ],
  [
    "cleaning",
    ["clean", "dirty", "trash", "rubbish", "bin", "spill", "toilet paper", "limpeza", "sujo"],
  ],
  ["noiseAndAcoustics", ["noise", "noisy", "loud", "acoustic", "barulho"]],
  ["mailAndPackages", ["mail", "package", "parcel", "delivery", "post", "letter", "encomenda"]],
  ["bookings", ["booking", "reservation", "room booking", "reserva"]],
  [
    "accountAndBilling",
    ["invoice", "billing", "charge", "payment", "account", "fatura", "cobranca"],
  ],
  ["websiteAndApp", ["app", "website", "login", "password reset"]],
  ["discriminationAndHarassment", ["harass", "discriminat", "assedio"]],
  ["offensiveOrObjectionableContent", ["offensive", "objectionable"]],
  [
    "repairAndMaintenance",
    [
      "broken",
      "repair",
      "leak",
      "light",
      "bulb",
      "chair",
      "desk",
      "socket",
      "plug",
      "maintenance",
      "quebrado",
      "conserto",
    ],
  ],
];
const TICKET_TYPE_NAMES = [...TICKET_TYPES.map(([t]) => t), "other"];

/** A ticket type from a category hint or the description itself; "other" when nothing fits. */
function ticketTypeFor(category, description) {
  for (const text of [category, description]) {
    const q = ` ${norm(text)} `;
    if (!q.trim()) continue;
    const exact = TICKET_TYPE_NAMES.find((t) => norm(t) === q.trim());
    if (exact) return exact;
    for (const [type, words] of TICKET_TYPES) {
      // Short words must match whole ("ac" is not "access"); longer ones may prefix ("print" → "printer").
      if (words.some((w) => q.includes(w.length <= 3 ? ` ${w} ` : ` ${w}`))) return type;
    }
  }
  return "other";
}

const ticketRequester = (t) => t.userRefRequester ?? t.requester?.id ?? null;
const OPEN_TICKET = (t) => !["resolved", "closed", "done", "cancelled"].includes(norm(t.status));

function shapeTicket(t, location) {
  return {
    id: t.id,
    type: t.type ?? null,
    status: t.status ?? null,
    text: typeof t.text === "string" ? t.text.slice(0, 300) : null,
    reported: t.createDate ? formatLocal(t.createDate, location.timeZone) : null,
  };
}

function registerSupportTools(server) {
  server.tool(
    "spacebring_report_issue",
    "Report a problem in the space to the team (WRITE): broken equipment, Wi-Fi down, too hot, " +
      "door access, cleaning, noise, printer, mail. Describe it in the member's words; the " +
      "category is worked out from the description when you do not pass one. Pass the member's " +
      "email so the team can follow up with them.",
    {
      description: z
        .string()
        .describe(
          "What is wrong and where, in the member's words, e.g. 'AC in Orange Room is not cooling'.",
        ),
      category: z
        .string()
        .optional()
        .describe(
          `Optional hint: wifi, printer, AC, access, cleaning, noise, mail, repair… (or one of ${TICKET_TYPE_NAMES.join(", ")}).`,
        ),
      member_email: z.string().optional().describe("Reporting member's email (recommended)."),
      location: z.string().optional().describe("Location name or id. Omit for the default."),
    },
    handle(async (args) => {
      const text = String(args.description ?? "").trim();
      if (text.length < 3) {
        throw toolError(
          "BAD_INPUT",
          "Ask the member what is wrong and where before reporting it.",
          {
            details: { field: "description" },
          },
        );
      }
      const location = await resolveLocation(args.location);
      const member = args.member_email
        ? await findMember(cleanEmail(args.member_email), location)
        : null;
      const type = ticketTypeFor(args.category, text);

      const res = await sbApi("POST", "/support/tickets/v1", {
        body: {
          ticket: {
            locationRef: location.id,
            text,
            type,
            userRefRequester: member?.userId ?? undefined,
          },
        },
      });
      const ticket = shapeTicket({ text, type, ...(itemOf(res, "ticket") ?? {}) }, location);
      return {
        status: "REPORTED",
        ticket,
        summary:
          `Reported to the ${location.name} team as "${type}"` +
          (member ? ` on behalf of ${member.name || member.email}` : "") +
          ". The member can follow it with spacebring_get_member.",
      };
    }),
  );
}

module.exports = {
  registerSupportTools,
  ticketTypeFor,
  shapeTicket,
  ticketRequester,
  OPEN_TICKET,
};
