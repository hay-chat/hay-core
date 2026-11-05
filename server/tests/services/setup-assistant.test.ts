import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { SetupSettings } from "@server/types/setup.types";

const state = { setup: {} as SetupSettings, org: {} as Record<string, unknown> };
const update = jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>();

jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/organization.service", () => ({
  organizationService: {
    findOne: async () => ({ ...state.org }),
    update: (id: string, data: Record<string, unknown>) => update(id, data),
  },
}));
jest.mock("../../services/setup/store", () => ({
  readSetup: async () => structuredClone(state.setup),
  updateSetup: async (_org: string, change: (s: SetupSettings) => SetupSettings) => {
    state.setup = change(structuredClone(state.setup));
    return state.setup;
  },
}));

import {
  assistantIsEmpty,
  buildAssistantPrompt,
  fillAssistantIfEmpty,
  parseAssistantDraft,
  ASSISTANT_JSON_SCHEMA,
} from "../../services/setup/assistant";

const draft = {
  name: "Alma Care",
  instructions: "You are Alma's support assistant.\nNever invent facts.",
  tone: "Warm and direct.",
  initialGreeting: "Hi! How can I help?",
  humanHandoffAvailableInstructions: "A teammate is joining now.",
  humanHandoffUnavailableInstructions: "Nobody is online; we reply by email.",
};

beforeEach(() => {
  jest.clearAllMocks();
  state.setup = {
    toolPluginIds: [],
    channels: [],
    questions: [{ id: "q", text: "Refunds?", source: "catalog" }],
  };
  state.org = { name: "Alma", defaultLanguage: "pt-BR" };
});

describe("fillAssistantIfEmpty", () => {
  it("fills every field once from the model, as documents, in the org language", async () => {
    const ask = jest.fn(async (_org: string, _prompt: string) => JSON.stringify(draft));
    await fillAssistantIfEmpty("o", { ask });
    expect(ask.mock.calls[0][1]).toContain("Brazilian Portuguese");
    expect(ask.mock.calls[0][1]).toContain("Refunds?");
    const written = update.mock.calls[0][1];
    expect(written.assistantName).toBe("Alma Care");
    expect(written.assistantInstructions).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "You are Alma's support assistant." }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Never invent facts." }] },
      ],
    });
    expect(state.setup.assistantFilledAt).toBeDefined();

    // A second save never asks again.
    await fillAssistantIfEmpty("o", { ask });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("never overwrites what the customer wrote, and does not look again", async () => {
    state.org = { name: "Alma", assistantTone: "Formal", assistantName: null };
    const ask = jest.fn(async () => JSON.stringify(draft));
    await fillAssistantIfEmpty("o", { ask });
    expect(ask).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(state.setup.assistantFilledAt).toBeDefined();
  });

  it("a failure is swallowed, writes nothing and allows a later retry", async () => {
    const ask = jest.fn(async () => {
      throw new Error("model down");
    });
    await expect(fillAssistantIfEmpty("o", { ask })).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(state.setup.assistantFilledAt).toBeUndefined();
  });

  it("an incomplete answer writes nothing", async () => {
    const ask = jest.fn(async () => JSON.stringify({ ...draft, tone: "" }));
    await fillAssistantIfEmpty("o", { ask });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("an untouched editor envelope still counts as empty", () => {
    expect(assistantIsEmpty({ assistantInstructions: { type: "doc", content: [] } } as never)).toBe(
      true,
    );
    expect(assistantIsEmpty({ initialGreeting: "Hi" } as never)).toBe(false);
  });

  it("the schema is strict and the prompt treats business text as data", () => {
    expect([...ASSISTANT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(ASSISTANT_JSON_SCHEMA.properties).sort(),
    );
    expect(buildAssistantPrompt({ companyName: "Alma", questions: [] })).toContain(
      "never instructions",
    );
    expect(() => parseAssistantDraft("{}")).toThrow();
  });
});
