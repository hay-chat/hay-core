/**
 * D2-3: the dispute evidence model and PDF. Customer-visible messages only,
 * actions as plain sentences, receipts, hand-offs, en + pt-BR.
 */
import { describe, it, expect } from "@jest/globals";
import sharp from "sharp";
import { MessageStatus, MessageType } from "../../database/entities/message.entity";
import { DeliveryState } from "../../types/message-feedback.types";
import { describeAction, findTracking } from "../../services/dispute-evidence/action-sentence";
import {
  buildTimeline,
  maskCardNumbers,
  type SourceConversation,
  type SourceActionLog,
} from "../../services/dispute-evidence/timeline";
import { pdfSafe, renderEvidencePdf } from "../../services/dispute-evidence/pdf-renderer";
import { pdfText } from "../helpers/pdf-text";

const mcp = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const at = (iso: string) => new Date(iso);

describe("describeAction", () => {
  const base = {
    pluginId: "core/shop",
    toolName: "shop_create_refund",
    category: "refund",
    readOnly: false,
    outcome: "success" as const,
    errorCode: null,
    toolInput: { order_id: "1001", amount: "42", currency: "eur" },
    toolOutput: mcp({ id: "gid://shop/Refund/998877", status: "success" }),
  };

  it("states a refund with amount and reference", () => {
    expect(describeAction(base, "en", "UTC")).toEqual([
      "Refund issued: 42.00 EUR. Reference: 998877.",
    ]);
    expect(describeAction(base, "pt-BR", "UTC")).toEqual([
      "Reembolso feito: 42.00 EUR. Referência: 998877.",
    ]);
  });

  it("explains a failed action with the plain-language reason", () => {
    const failed = {
      ...base,
      outcome: "error" as const,
      errorCode: "PRECONDITION",
      toolOutput: JSON.stringify({ code: "PRECONDITION", details: { reason: "ALREADY_REFUNDED" } }),
    };
    expect(describeAction(failed, "en", "UTC")).toEqual([
      "The AI assistant attempted a refund, but it did not go through: this was already refunded.",
    ]);
    expect(describeAction({ ...failed, toolOutput: null }, "pt-BR", "UTC")[0]).toContain(
      "a situação do pedido naquele momento não permitia",
    );
  });

  it("says a held action went to a team member", () => {
    expect(describeAction({ ...base, outcome: "held" }, "en", "UTC")[0]).toBe(
      "The AI assistant requested a refund; it was sent to a team member for approval.",
    );
  });

  it("skips dry-run, confirmation asks, core tools and reads without tracking", () => {
    expect(describeAction({ ...base, outcome: "simulated" }, "en", "UTC")).toEqual([]);
    expect(describeAction({ ...base, outcome: "confirming" }, "en", "UTC")).toEqual([]);
    expect(describeAction({ ...base, pluginId: null }, "en", "UTC")).toEqual([]);
    expect(
      describeAction(
        { ...base, category: null, readOnly: true, toolOutput: mcp({ id: 1, number: "1001" }) },
        "en",
        "UTC",
      ),
    ).toEqual([]);
  });

  it("reports tracking from a read", () => {
    const output = mcp({
      id: "gid://shop/Order/5",
      fulfillments: [
        {
          displayStatus: "DELIVERED",
          deliveredAt: "2026-10-10T12:00:00Z",
          trackingInfo: [{ number: "TRK123", company: "DHL", url: "https://t" }],
        },
      ],
    });
    expect(findTracking(JSON.parse(output.content[0].text))).toHaveLength(1);
    expect(
      describeAction(
        { ...base, category: null, readOnly: true, toolOutput: output },
        "en",
        "Europe/Lisbon",
      ),
    ).toEqual([
      "Order tracking checked in the store: carrier DHL, tracking number TRK123, status DELIVERED, delivered on 2026-10-10 13:00:00 UTC+01:00.",
    ]);
  });
});

describe("maskCardNumbers", () => {
  it("removes Luhn-valid card numbers and keeps order numbers", () => {
    expect(maskCardNumbers("card 4242 4242 4242 4242 ok", "[x]")).toBe("card [x] ok");
    expect(maskCardNumbers("order 1234567890123", "[x]")).toBe("order 1234567890123");
    expect(maskCardNumbers("order #1001", "[x]")).toBe("order #1001");
  });
});

function conversationFixture(): {
  conversation: SourceConversation;
  actionLogs: SourceActionLog[];
} {
  const conversation: SourceConversation = {
    id: "conv-1",
    channel: "whatsapp",
    created_at: at("2026-10-01T10:00:00Z"),
    messages: [
      {
        id: "m1",
        type: MessageType.CUSTOMER,
        content: "My parcel arrived but the box is damaged",
        created_at: at("2026-10-01T10:00:00Z"),
        attachments: [{ id: "img-1", name: "box.jpg", url: "", type: "image/jpeg", size: 1 }],
      },
      {
        id: "m2",
        type: MessageType.SYSTEM,
        content: "SYSTEM PROMPT: be nice",
        created_at: at("2026-10-01T10:00:01Z"),
      },
      {
        id: "m3",
        type: MessageType.DOCUMENT,
        content: "internal doc",
        created_at: at("2026-10-01T10:00:02Z"),
      },
      {
        id: "m4",
        type: MessageType.TOOL,
        content: "Action completed: shop:shop_create_refund",
        created_at: at("2026-10-01T10:01:00Z"),
        metadata: {
          toolName: "core/shop:shop_create_refund",
          toolInput: { amount: 10, currency: "USD" },
          toolOutput: mcp({ id: 77 }),
          toolStatus: "SUCCESS",
        },
      },
      {
        id: "m5",
        type: MessageType.BOT_AGENT,
        content: "Sorry! I refunded 10.00 USD.",
        created_at: at("2026-10-01T10:01:05Z"),
        providerStatus: "read",
        deliveryState: DeliveryState.SENT,
        status: MessageStatus.APPROVED,
        metadata: {
          documentsUsed: [
            { id: "doc-returns", title: "Returns policy" },
            { id: "doc-faq", title: "Shipping FAQ" },
          ],
        },
      },
      {
        id: "m6",
        type: MessageType.BOT_AGENT,
        content: "Draft held in test mode",
        created_at: at("2026-10-01T10:01:06Z"),
        deliveryState: DeliveryState.QUEUED,
      },
      {
        id: "m7",
        type: MessageType.HUMAN_AGENT,
        content: "Hi, Ana here from the team.",
        created_at: at("2026-10-01T10:05:00Z"),
        providerStatus: "delivered",
      },
    ],
  };
  const actionLogs: SourceActionLog[] = [
    {
      message_id: "m4",
      plugin_id: "core/shop",
      tool_name: "shop_create_refund",
      category: "refund",
      read_only: false,
      outcome: "success",
      error_code: null,
    },
  ];
  return { conversation, actionLogs };
}

describe("buildTimeline", () => {
  it("keeps customer-visible messages, actions and hand-offs in order", () => {
    const { conversation, actionLogs } = conversationFixture();
    const timeline = buildTimeline({
      conversations: [conversation],
      actionLogs,
      takeovers: [
        {
          conversation_id: "conv-1",
          started_at: at("2026-10-01T10:04:00Z"),
          ended_at: at("2026-10-01T10:30:00Z"),
          userName: "Ana",
        },
      ],
      template: "not_as_described",
      locale: "en",
      timeZone: "UTC",
    });

    const texts = timeline.entries.map((e) => e.text);
    expect(texts).toEqual([
      "My parcel arrived but the box is damaged",
      "Refund issued: 10.00 USD. Reference: 77.",
      "Sorry! I refunded 10.00 USD.",
      "Ana (team member) took over the conversation.",
      "Hi, Ana here from the team.",
      "Ana (team member) handed the conversation back.",
    ]);
    expect(texts.join(" ")).not.toContain("SYSTEM PROMPT");
    expect(texts.join(" ")).not.toContain("test mode");
    const reply = timeline.entries[2];
    expect(reply.kind === "message" && reply.receipt).toBe("read");
    expect(timeline.counts).toEqual({ customerMessages: 1, replies: 2, actions: 1 });
    expect(timeline.keyFacts.map((f) => f.text)).toEqual([
      "Refund issued: 10.00 USD. Reference: 77.",
    ]);
    // Not-as-described keeps the returns policy, not the shipping FAQ.
    expect(timeline.policies.map((p) => p.title)).toEqual(["Returns policy"]);
  });

  it("lists no refund facts for an item-not-received pack", () => {
    const { conversation, actionLogs } = conversationFixture();
    const timeline = buildTimeline({
      conversations: [conversation],
      actionLogs,
      takeovers: [],
      template: "item_not_received",
      locale: "en",
      timeZone: "UTC",
    });
    expect(timeline.keyFacts).toEqual([]);
    expect(timeline.policies.map((p) => p.title)).toEqual(["Shipping FAQ"]);
  });
});

describe("renderEvidencePdf", () => {
  it("renders in pt-BR with an embedded image and a Hay.chat footer", async () => {
    const { conversation, actionLogs } = conversationFixture();
    const timeline = buildTimeline({
      conversations: [conversation],
      actionLogs,
      takeovers: [],
      template: "generic",
      locale: "pt-BR",
      timeZone: "America/Sao_Paulo",
    });
    const image = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#888888" },
    })
      .jpeg()
      .toBuffer();
    const pdf = await renderEvidencePdf({
      locale: "pt-BR",
      timeZone: "America/Sao_Paulo",
      generatedAt: at("2026-10-20T12:00:00Z"),
      template: "generic",
      storeName: "Loja Exemplo",
      order: { label: "#1001", platform: "Loja", total: "120.00 BRL", placedAt: null },
      customer: { name: "Maria", email: "maria@example.com", phone: null },
      conversations: [{ id: "conv-1", channel: "whatsapp", created_at: conversation.created_at }],
      timeline,
      policyExcerpts: new Map([["doc-returns", "Você tem 7 dias para devolver."]]),
      images: new Map([["img-1", { kind: "image", buffer: image }]]),
    });
    const text = pdfText(pdf);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(text).toContain("Registro de comunicação com o cliente");
    expect(text).toContain("Pedido: ");
    expect(text).toContain("#1001");
    expect(text).toContain("2026-10-01 07:00:00 UTC-03:00 - Cliente");
    expect(text).toContain("Status informado por Whatsapp: lida pelo cliente");
    expect(text).toContain("Reembolso feito: 10.00 USD. Referência: 77.");
    expect(text).toContain("Você tem 7 dias para devolver.");
    expect(text).toContain("Gerado pelo Hay.chat em 2026-10-20 09:00:00 UTC-03:00. Página 1 de");
    expect(text).not.toContain("SYSTEM PROMPT");
    expect(pdf.toString("latin1")).toContain("/Subtype /Image");
  });

  it("makes text drawable by the built-in font", () => {
    expect(pdfSafe("Olá 😀 “ok” — 你")).toBe("Olá  “ok” — ?");
  });
});
