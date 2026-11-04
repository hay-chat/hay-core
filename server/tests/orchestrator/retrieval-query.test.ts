const search = jest.fn();

jest.mock("@server/services/vector-store.service", () => ({
  vectorStoreService: { initialized: true, initialize: jest.fn(), search },
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));

import type { Message } from "@server/database/entities/message.entity";
import { RetrievalLayer } from "../../orchestrator/retrieval.layer";

const customer = (content: string) => ({ type: "Customer", content }) as Message;
const bot = (content: string) => ({ type: "BotAgent", content }) as Message;

describe("RetrievalLayer.getRelevantDocuments", () => {
  beforeEach(() => search.mockReset());

  it("finds a doc for a new topic that the joined history would bury", async () => {
    // Joined history embeds as a tray question: the shipping chunk lands under the threshold.
    search.mockImplementation(async (_org: string, query: string) =>
      query.startsWith("Does the oak")
        ? [
            { id: "c-faq", documentId: "faq", similarity: 0.45 },
            { id: "c-ship", documentId: "shipping", similarity: 0.39 },
          ]
        : [
            { id: "c-ship", documentId: "shipping", similarity: 0.57 },
            { id: "c-faq", documentId: "faq", similarity: 0.2 },
          ],
    );

    const docs = await new RetrievalLayer().getRelevantDocuments(
      [
        customer("Does the oak serving tray come gift-boxed?"),
        bot("I'm checking with the team."),
        customer("Also, can you engrave it?"),
        bot("I've added that to my question for the team."),
        customer("And how long does US shipping take?"),
      ],
      "org-1",
    );

    expect(search).toHaveBeenCalledWith("org-1", "And how long does US shipping take?", 5);
    expect(docs).toEqual([
      { id: "shipping", similarity: 0.57 },
      { id: "faq", similarity: 0.45 },
    ]);
  });

  it("searches once when there is a single customer message", async () => {
    search.mockResolvedValue([{ id: "c1", documentId: "d1", similarity: 0.8 }]);

    const docs = await new RetrievalLayer().getRelevantDocuments(
      [customer("Is the planter frost-safe?")],
      "org-1",
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(docs).toEqual([{ id: "d1", similarity: 0.8 }]);
  });
});
