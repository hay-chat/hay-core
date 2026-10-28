/**
 * `complete_product_case` core tool (D8-14): the AI closes a product-problem
 * intake. The tool checks the evidence checklist against the conversation
 * (photos, lot number, invoice) and the AI's input (how used, timeline); it
 * returns what is missing, or marks the case complete on the conversation.
 */

import { createLogger } from "@server/lib/logger";
import {
  buildProductCase,
  evaluateProductCase,
  readProductCase,
  saveProductCase,
  type ProductCaseInput,
} from "@server/services/product-case/product-case";
import type { CoreToolDefinition } from "./index";

const logger = createLogger("core-tool:complete-product-case");

const MISSING_HINTS: Record<string, string> = {
  photos: "photos of the problem or the product",
  lot_number: "the lot or batch number from the label",
  invoice: "the invoice, receipt or nota fiscal (file or number)",
  how_used: "how the product was used and stored",
  timeline: "when it was bought, first used, and when the problem started",
};

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const completeProductCaseTool: CoreToolDefinition = {
  name: "complete_product_case",
  description:
    "Only during a product-problem intake playbook: mark the case complete once the customer has given " +
    "photos, the lot/batch number, the invoice (file or number), how the product was used, and a timeline. " +
    "Returns the items still missing, if any. Photos, lot and invoice numbers the customer sent as files are found automatically.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "howUsed", "timeline"],
    properties: {
      summary: { type: "string", description: "2-4 sentences for the store's team: what happened." },
      product: { type: "string", description: "The product, as the customer named it." },
      lotNumber: { type: "string", description: "Lot/batch number, if the customer typed it." },
      invoiceNumber: { type: "string", description: "Invoice or order number, if the customer typed it." },
      howUsed: { type: "string", description: "How the product was used and stored." },
      timeline: { type: "string", description: "Bought, first used, problem started." },
    },
  },

  async execute(conversation, args) {
    const existing = readProductCase(conversation);
    if (existing?.status === "complete") {
      return { complete: true, alreadyComplete: true };
    }

    const input: ProductCaseInput = {
      summary: text(args.summary),
      product: text(args.product),
      lotNumber: text(args.lotNumber),
      invoiceNumber: text(args.invoiceNumber),
      howUsed: text(args.howUsed),
      timeline: text(args.timeline),
    };
    const messages = await conversation.getMessages();
    const evaluation = evaluateProductCase(messages, input);
    if (!evaluation.evidence) {
      return {
        complete: false,
        missing: (evaluation.missing ?? []).map((item) => MISSING_HINTS[item] ?? item),
      };
    }

    const productCase = buildProductCase(input, evaluation.evidence);
    await saveProductCase(conversation.id, conversation.organization_id, productCase);
    conversation.metadata = { ...(conversation.metadata ?? {}), productCase };
    logger.info({ conversationId: conversation.id }, "Product case complete");
    return { complete: true };
  },
};
