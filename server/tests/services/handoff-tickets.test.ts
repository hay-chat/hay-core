/**
 * Hand-off tickets without a database or a plugin worker: the conversation
 * and plugin-instance repositories and the worker's HTTP reply are the boundary.
 */
import { describe, it, expect, jest, afterEach, beforeEach } from "@jest/globals";
import type { Conversation } from "../../database/entities/conversation.entity";
import { MessageType, type Message } from "../../database/entities/message.entity";
import type { PluginInstance } from "../../entities/plugin-instance.entity";
import { conversationRepository } from "../../repositories/conversation.repository";
import { pluginInstanceRepository } from "../../repositories/plugin-instance.repository";
import { hookManager } from "../../services/hooks/hook-manager";
import {
  HandoffTicketsService,
  buildTicketTranscript,
  ticketHandoffInstructions,
} from "../../services/handoff-tickets/handoff-tickets.service";

const ORG = "org-1";

function instance(pluginId: string, capabilities: string[]): PluginInstance {
  return {
    plugin: { pluginId, name: pluginId, manifest: { capabilities } },
  } as unknown as PluginInstance;
}

function conversation(overrides: Record<string, unknown> = {}): Conversation & {
  addMessage: jest.Mock;
} {
  return {
    id: "conv-1",
    organization_id: ORG,
    channel: "web",
    status: "pending-human",
    metadata: { handoffTicket: { pluginId: "zendesk", status: "requested" } },
    agent: {
      human_handoff_unavailable_ticket: { pluginId: "zendesk", fields: { priority: "high" } },
    },
    customer: { name: "Ana", email: null, phone: null },
    getMessages: async () =>
      [
        { type: MessageType.CUSTOMER, content: "My mug arrived broken" },
        { type: MessageType.SYSTEM, content: "internal" },
        { type: MessageType.BOT_AGENT, content: "Sorry to hear that" },
      ] as Message[],
    addMessage: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as Conversation & { addMessage: jest.Mock };
}

function workerReply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("HandoffTicketsService", () => {
  const service = new HandoffTicketsService({ workerPort: async () => 5999 });
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let update: jest.SpiedFunction<typeof conversationRepository.update>;

  beforeEach(() => {
    jest
      .spyOn(pluginInstanceRepository, "findEnabledByOrganization")
      .mockResolvedValue([instance("zendesk", ["mcp", "tickets"]), instance("shopify", ["mcp"])]);
    fetchMock = jest.spyOn(global, "fetch");
    update = jest.spyOn(conversationRepository, "update").mockResolvedValue(null);
    jest.spyOn(hookManager, "trigger").mockResolvedValue(undefined as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it("lists only enabled plugins that declare the tickets capability", async () => {
    expect(await service.listProviders(ORG)).toEqual([{ pluginId: "zendesk", name: "zendesk" }]);
    expect(await service.isProvider(ORG, "shopify")).toBe(false);
  });

  it("refuses to read a form from a plugin that cannot create tickets", async () => {
    expect(await service.readForm(ORG, "shopify")).toMatchObject({
      ok: false,
      code: "NOT_CONNECTED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for an email before raising a ticket nobody could answer", async () => {
    jest.spyOn(conversationRepository, "findById").mockResolvedValue(conversation());
    const result = await service.raise(conversation(), {
      subject: "Broken mug",
      summary: "Wants a refund",
    });
    expect(result).toEqual({ created: false, missing: ["the customer's email address"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing unless the hand-off asked for a ticket", async () => {
    jest
      .spyOn(conversationRepository, "findById")
      .mockResolvedValue(conversation({ metadata: {} }));
    const result = await service.raise(conversation(), {
      subject: "Broken mug",
      summary: "Wants a refund",
      email: "ana@example.com",
    });
    expect(result).toMatchObject({ created: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises the ticket with the prefilled fields and records it on the conversation", async () => {
    const current = conversation();
    jest.spyOn(conversationRepository, "findById").mockResolvedValue(current);
    fetchMock.mockResolvedValue(
      workerReply({
        ok: true,
        ticketId: "987",
        ticketUrl: "https://acme.zendesk.com/agent/tickets/987",
      }),
    );

    const result = await service.raise(current, {
      subject: "Broken mug",
      summary: "Wants a refund",
      email: "ana@example.com",
    });

    expect(result).toEqual({ created: true, ticketId: "987" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:5999/tickets/create");
    const body = JSON.parse(String(init.body));
    expect(body.requester).toEqual({ name: "Ana", email: "ana@example.com" });
    expect(body.fields).toEqual({ priority: "high" });
    expect(body.transcript).toBe("Ana: My mug arrived broken\nAI agent: Sorry to hear that");
    expect(body.conversation.url).toContain("/conversations/conv-1?org=org-1");
    expect(update).toHaveBeenCalledWith(
      "conv-1",
      ORG,
      expect.objectContaining({
        metadata: expect.objectContaining({
          handoffTicket: expect.objectContaining({ status: "created", ticketId: "987" }),
        }),
      }),
    );
    expect(current.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.SYSTEM,
        content: expect.stringContaining("#987"),
      }),
    );
  });

  it("reports a helpdesk refusal and leaves the conversation in the queue", async () => {
    const current = conversation({ customer: { name: "Ana", email: "ana@example.com" } });
    jest.spyOn(conversationRepository, "findById").mockResolvedValue(current);
    fetchMock.mockResolvedValue(
      workerReply({ ok: false, code: "INVALID_FIELDS", message: "group does not exist" }),
    );

    const result = await service.raise(current, {
      subject: "Broken mug",
      summary: "Wants a refund",
    });

    expect(result).toEqual({ created: false, error: "The ticket could not be created" });
    expect(update).not.toHaveBeenCalled();
  });

  it("closes a pending conversation once its ticket exists, and only then", async () => {
    const findById = jest.spyOn(conversationRepository, "findById");

    findById.mockResolvedValue(conversation());
    expect(await service.closeIfRaised("conv-1", ORG)).toBe(false);

    findById.mockResolvedValue(
      conversation({
        metadata: { handoffTicket: { pluginId: "zendesk", status: "created", ticketId: "987" } },
      }),
    );
    expect(await service.closeIfRaised("conv-1", ORG)).toBe(true);
    expect(update).toHaveBeenCalledWith(
      "conv-1",
      ORG,
      expect.objectContaining({
        status: "resolved",
        resolution_metadata: expect.objectContaining({ reason: "ticket_created" }),
      }),
    );
  });
});

describe("hand-off ticket copy", () => {
  it("keeps the latest messages when the transcript is long", () => {
    const messages = Array.from({ length: 2000 }, (_, i) => ({
      type: MessageType.CUSTOMER,
      content: `message number ${i} with some padding text`,
    })) as Message[];
    const transcript = buildTicketTranscript(messages);
    expect(transcript.length).toBeLessThan(30_100);
    expect(transcript.endsWith("message number 1999 with some padding text")).toBe(true);
  });

  it("tells the planner not to raise a second ticket", () => {
    expect(
      ticketHandoffInstructions("Closed", { pluginId: "zendesk", status: "created" }),
    ).toContain("Do not call create_ticket again");
    expect(
      ticketHandoffInstructions("Closed", { pluginId: "zendesk", status: "requested" }),
    ).toContain("Call create_ticket");
  });
});
