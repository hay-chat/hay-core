import { describe, expect, it, vi } from "vitest";
import type { TicketCreateRequest } from "@hay/plugin-sdk";
import { createTicket, HAY_TICKET_TAG, readTicketForm, toZendeskTicket } from "./tickets";

const creds = { subdomain: "acme", email: "admin@acme.test", apiToken: "token" };

function request(overrides: Partial<TicketCreateRequest> = {}): TicketCreateRequest {
  return {
    subject: "Refund for order #1001",
    summary: "The customer wants a refund for a damaged mug.",
    transcript: "Ana: my mug arrived broken\nAgent: I'm sorry to hear that",
    requester: { name: "Ana", email: "ana@example.com" },
    fields: {},
    conversation: { id: "c1", url: "https://app.hay.chat/conversations/c1", channel: "web" },
    ...overrides,
  };
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("toZendeskTicket", () => {
  it("writes an internal note with the summary, the link and the transcript", () => {
    const ticket = toZendeskTicket(request());
    expect(ticket.subject).toBe("Refund for order #1001");
    expect(ticket.requester).toEqual({ email: "ana@example.com", name: "Ana" });
    const comment = ticket.comment as { body: string; public: boolean };
    expect(comment.public).toBe(false);
    expect(comment.body).toContain("The customer wants a refund");
    expect(comment.body).toContain("https://app.hay.chat/conversations/c1");
    expect(comment.body).toContain("Ana: my mug arrived broken");
    expect(ticket.tags).toEqual([HAY_TICKET_TAG]);
  });

  it("maps the prefilled fields and drops the ones Zendesk would refuse", () => {
    const ticket = toZendeskTicket(
      request({
        fields: {
          group_id: "360001",
          priority: "high",
          type: "nonsense",
          tags: "VIP, after_hours",
          custom_42: "returns",
          custom_43: ["a", "b"],
          custom_44: "",
          unknown: "ignored",
        },
      }),
    );
    expect(ticket.group_id).toBe(360001);
    expect(ticket.priority).toBe("high");
    expect(ticket.type).toBeUndefined();
    expect(ticket.tags).toEqual([HAY_TICKET_TAG, "vip", "after_hours"]);
    expect(ticket.custom_fields).toEqual([
      { id: 42, value: "returns" },
      { id: 43, value: ["a", "b"] },
    ]);
    expect(ticket).not.toHaveProperty("unknown");
  });

  it("keeps the phone in the note when there is no email", () => {
    const ticket = toZendeskTicket(
      request({ requester: { name: "Ana", phone: "+351 912 345 678" } }),
    );
    expect(ticket.requester).toBeUndefined();
    expect((ticket.comment as { body: string }).body).toContain("Phone: +351 912 345 678");
  });
});

describe("readTicketForm", () => {
  it("offers groups, priority, type, tags and the account's custom fields", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes("/groups/assignable")) {
        return reply(200, {
          groups: [
            { id: 1, name: "Support" },
            { id: 2, name: "Old", deleted: true },
          ],
        });
      }
      if (path.includes("/ticket_fields")) {
        return reply(200, {
          ticket_fields: [
            { id: 10, type: "subject", title: "Subject", removable: false },
            {
              id: 42,
              type: "tagger",
              title: "Topic",
              removable: true,
              custom_field_options: [{ name: "Returns", value: "returns" }],
            },
            { id: 43, type: "date", title: "Due", removable: true },
            { id: 44, type: "checkbox", title: "VIP", removable: true, active: false },
          ],
        });
      }
      return reply(403, { error: "Forbidden" });
    });

    const form = await readTicketForm(creds, fetchImpl as unknown as typeof fetch);
    expect(form.ok).toBe(true);
    if (!form.ok) return;
    expect(form.fields.map((field) => field.key)).toEqual([
      "group_id",
      "priority",
      "type",
      "tags",
      "custom_42",
    ]);
    expect(form.fields[0].options).toEqual([{ value: "1", label: "Support" }]);
    expect(form.fields[4]).toMatchObject({
      label: "Topic",
      type: "select",
      options: [{ value: "returns", label: "Returns" }],
    });
  });

  it("reports rejected credentials as not connected", async () => {
    const fetchImpl = vi.fn(async () => reply(401, { error: "Couldn't authenticate you" }));
    expect(await readTicketForm(creds, fetchImpl as unknown as typeof fetch)).toMatchObject({
      ok: false,
      code: "NOT_CONNECTED",
    });
  });
});

describe("createTicket", () => {
  it("returns the ticket id and the agent link", async () => {
    const fetchImpl = vi.fn(async () => reply(201, { ticket: { id: 987 } }));
    const result = await createTicket(creds, request(), fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({
      ok: true,
      ticketId: "987",
      ticketUrl: "https://acme.zendesk.com/agent/tickets/987",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://acme.zendesk.com/api/v2/tickets.json");
    expect(JSON.parse(String(init.body)).ticket.subject).toBe("Refund for order #1001");
  });

  it("maps a 422 to INVALID_FIELDS", async () => {
    const fetchImpl = vi.fn(async () => reply(422, { error: "RecordInvalid" }));
    expect(
      await createTicket(creds, request(), fetchImpl as unknown as typeof fetch),
    ).toMatchObject({
      ok: false,
      code: "INVALID_FIELDS",
    });
  });
});
