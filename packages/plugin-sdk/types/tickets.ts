/**
 * Hay Plugin SDK - Helpdesk Ticket Types (hand-off when nobody is available)
 *
 * Plugins connected to a helpdesk (Zendesk, ...) declare the `tickets`
 * capability and answer two core-only worker routes:
 *
 * - `POST /tickets/form` (`TICKET_FORM_ROUTE`): the fields the merchant can
 *   prefill, read from their own account (groups, priorities, custom fields).
 * - `POST /tickets/create` (`TICKET_CREATE_ROUTE`): raise one ticket for a
 *   conversation the team could not take.
 *
 * Core owns when a ticket is raised, the summary and transcript, and closing
 * the conversation; the plugin only talks to the helpdesk.
 *
 * @module @hay/plugin-sdk/types/tickets
 */

/** A value the merchant prefilled. Multi-value fields use `string[]`. */
export type TicketFieldValue = string | number | boolean | string[];

export interface TicketFormOption {
  value: string;
  label: string;
}

/** One field the merchant can prefill on every ticket. */
export interface TicketFormField {
  /** Stable key the plugin reads back in `TicketCreateRequest.fields` (e.g. `group_id`, `custom_123`). */
  key: string;
  label: string;
  type: "select" | "multiselect" | "text" | "checkbox" | "number";
  /** Choices for `select` and `multiselect`. */
  options?: TicketFormOption[];
  description?: string;
}

/** Reply to `POST /tickets/form`. */
export type TicketFormResponse =
  | { ok: true; fields: TicketFormField[] }
  | { ok: false; code: TicketErrorCode; message: string };

/** Body of core's `POST /tickets/create`. */
export interface TicketCreateRequest {
  /** One line for the ticket subject, in the customer's language. */
  subject: string;
  /** What the customer needs, written for the team. */
  summary: string;
  /** The public conversation, oldest first, one "Name: text" line per message. */
  transcript: string;
  /** Who the team replies to. Core sends at least an email or a phone. */
  requester: { name?: string; email?: string; phone?: string };
  /** The merchant's prefilled values, keyed by `TicketFormField.key`. Unknown keys are ignored. */
  fields: Record<string, TicketFieldValue>;
  conversation: {
    id: string;
    /** The conversation in the Hay.chat dashboard. */
    url?: string;
    /** "web" or a channel plugin's channel id. */
    channel?: string;
  };
}

export type TicketErrorCode =
  /** The helpdesk is not connected (missing or rejected credentials). */
  | "NOT_CONNECTED"
  /** The helpdesk refused the ticket (e.g. a prefilled field no longer exists). */
  | "INVALID_FIELDS"
  | "PROVIDER_ERROR";

/** Reply to `POST /tickets/create`. */
export type TicketCreateResponse =
  | { ok: true; ticketId: string; ticketUrl?: string }
  | { ok: false; code: TicketErrorCode; message: string };
