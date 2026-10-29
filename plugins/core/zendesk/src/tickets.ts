/**
 * Hand-off tickets (`tickets` capability): the prefill form read from the
 * merchant's Zendesk account, and raising one ticket for a conversation the
 * team could not take. Core decides when; this file only talks to Zendesk.
 */

import type {
  TicketCreateRequest,
  TicketCreateResponse,
  TicketFieldValue,
  TicketFormField,
  TicketFormResponse,
} from "@hay/plugin-sdk";

export interface ZendeskCredentials {
  subdomain: string;
  email: string;
  apiToken: string;
}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

/** Every ticket Hay.chat raises carries this tag, so the team can build views and triggers on it. */
export const HAY_TICKET_TAG = "hay_chat_handoff";

const PRIORITIES = ["low", "normal", "high", "urgent"];
const TYPES = ["question", "incident", "problem", "task"];

/** Zendesk custom field types the form can offer; the rest (date, lookup, credit card) are skipped. */
const CUSTOM_FIELD_TYPES: Record<string, TicketFormField["type"]> = {
  tagger: "select",
  multiselect: "multiselect",
  checkbox: "checkbox",
  integer: "number",
  decimal: "number",
  text: "text",
  textarea: "text",
  regexp: "text",
};

const CUSTOM_PREFIX = "custom_";

class ZendeskError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function zendesk(
  creds: ZendeskCredentials,
  fetchImpl: Fetch,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Json> {
  const auth = Buffer.from(`${creds.email}/token:${creds.apiToken}`).toString("base64");
  const response = await fetchImpl(`https://${creds.subdomain}.zendesk.com/api/v2${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ZendeskError(response.status, text.slice(0, 500) || response.statusText);
  }
  return (await response.json()) as Json;
}

function failure(error: unknown): {
  ok: false;
  code: "NOT_CONNECTED" | "INVALID_FIELDS" | "PROVIDER_ERROR";
  message: string;
} {
  if (error instanceof ZendeskError) {
    if (error.status === 401 || error.status === 403) {
      return { ok: false, code: "NOT_CONNECTED", message: "Zendesk rejected the credentials" };
    }
    if (error.status === 422) {
      return {
        ok: false,
        code: "INVALID_FIELDS",
        message: `Zendesk refused the ticket: ${error.message}`,
      };
    }
    return { ok: false, code: "PROVIDER_ERROR", message: `Zendesk answered ${error.status}` };
  }
  return { ok: false, code: "PROVIDER_ERROR", message: "Zendesk could not be reached" };
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

/** The fields a merchant can prefill, from their account. */
export async function readTicketForm(
  creds: ZendeskCredentials,
  fetchImpl: Fetch = fetch,
): Promise<TicketFormResponse> {
  try {
    // TODO: follow next_page for accounts with more than 100 groups or fields.
    const [groups, ticketFields, ticketForms] = await Promise.all([
      zendesk(creds, fetchImpl, "GET", "/groups/assignable.json?per_page=100"),
      zendesk(creds, fetchImpl, "GET", "/ticket_fields.json?per_page=100"),
      // Ticket forms are an Enterprise feature; other plans answer 403.
      zendesk(creds, fetchImpl, "GET", "/ticket_forms.json?active=true").catch((): Json => ({})),
    ]);

    const fields: TicketFormField[] = [];

    const forms = list(ticketForms.ticket_forms).filter((form) => form.active !== false);
    if (forms.length > 1) {
      fields.push({
        key: "ticket_form_id",
        label: "Ticket form",
        type: "select",
        options: forms.map((form) => ({ value: String(form.id), label: String(form.name) })),
      });
    }

    fields.push(
      {
        key: "group_id",
        label: "Group",
        type: "select",
        options: list(groups.groups)
          .filter((group) => group.deleted !== true)
          .map((group) => ({ value: String(group.id), label: String(group.name) })),
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        options: PRIORITIES.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })),
      },
      {
        key: "type",
        label: "Type",
        type: "select",
        options: TYPES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
      },
      {
        key: "tags",
        label: "Tags",
        type: "text",
        description: `Separated by spaces or commas. "${HAY_TICKET_TAG}" is always added.`,
      },
    );

    for (const field of list(ticketFields.ticket_fields)) {
      const type = CUSTOM_FIELD_TYPES[String(field.type)];
      if (!type || field.active === false || field.removable === false) continue;
      fields.push({
        key: `${CUSTOM_PREFIX}${field.id}`,
        label: String(field.title),
        type,
        ...(type === "select" || type === "multiselect"
          ? {
              options: list(field.custom_field_options).map((option) => ({
                value: String(option.value),
                label: String(option.name),
              })),
            }
          : {}),
        ...(typeof field.description === "string" && field.description
          ? { description: field.description }
          : {}),
      });
    }

    return { ok: true, fields };
  } catch (error) {
    return failure(error);
  }
}

function present(value: TicketFieldValue | undefined): value is TicketFieldValue {
  if (value === undefined || value === null || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

function splitTags(value: TicketFieldValue | undefined): string[] {
  if (!present(value)) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  return raw.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

function numeric(value: TicketFieldValue): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** The Zendesk ticket payload for a hand-off. Pure, so it is tested without the network. */
export function toZendeskTicket(request: TicketCreateRequest): Json {
  const { fields, requester } = request;

  const reachBy = [
    requester.email ? `Email: ${requester.email}` : null,
    requester.phone ? `Phone: ${requester.phone}` : null,
  ].filter(Boolean);
  const body = [
    request.summary.trim(),
    reachBy.length ? `Customer: ${[requester.name, ...reachBy].filter(Boolean).join(" · ")}` : null,
    request.conversation.url ? `Conversation in Hay.chat: ${request.conversation.url}` : null,
    `--- Conversation ---\n${request.transcript.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const ticket: Json = {
    subject: request.subject.trim().slice(0, 250),
    // An internal note: the summary is written for the team, and the transcript
    // is the customer's own words. The team's first public reply reaches them.
    comment: { body, public: false },
    tags: [...new Set([HAY_TICKET_TAG, ...splitTags(fields.tags)])],
  };
  // Without an email Zendesk cannot reach the customer; the ticket stays on the
  // API user and the phone is in the note.
  // TODO: create or find an end user by phone when the account uses Zendesk Talk/SMS.
  if (requester.email) {
    ticket.requester = { email: requester.email, name: requester.name || requester.email };
  }

  if (present(fields.priority) && PRIORITIES.includes(String(fields.priority))) {
    ticket.priority = String(fields.priority);
  }
  if (present(fields.type) && TYPES.includes(String(fields.type))) {
    ticket.type = String(fields.type);
  }
  for (const key of ["group_id", "ticket_form_id"]) {
    const value = fields[key];
    if (present(value) && numeric(value as TicketFieldValue) !== undefined) {
      ticket[key] = numeric(value as TicketFieldValue);
    }
  }

  const customFields = Object.entries(fields)
    .filter(([key, value]) => key.startsWith(CUSTOM_PREFIX) && present(value))
    .map(([key, value]) => ({ id: Number(key.slice(CUSTOM_PREFIX.length)), value }))
    .filter((field) => Number.isInteger(field.id));
  if (customFields.length) ticket.custom_fields = customFields;

  return ticket;
}

export async function createTicket(
  creds: ZendeskCredentials,
  request: TicketCreateRequest,
  fetchImpl: Fetch = fetch,
): Promise<TicketCreateResponse> {
  try {
    const result = await zendesk(creds, fetchImpl, "POST", "/tickets.json", {
      ticket: toZendeskTicket(request),
    });
    const id = (result.ticket as Json | undefined)?.id;
    if (id === undefined || id === null) {
      return { ok: false, code: "PROVIDER_ERROR", message: "Zendesk did not return a ticket" };
    }
    return {
      ok: true,
      ticketId: String(id),
      ticketUrl: `https://${creds.subdomain}.zendesk.com/agent/tickets/${id}`,
    };
  } catch (error) {
    return failure(error);
  }
}
