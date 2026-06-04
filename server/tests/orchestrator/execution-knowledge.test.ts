import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Regression test for the document-RAG injection path.
 *
 * Bug: retrieved knowledge-base documents were attached to the conversation as
 * `document_ids` but their content was never injected into the generation prompt
 * (it was only read by the post-generation confidence guardrail), so the knowledge
 * base did not actually inform answers. `buildKnowledgePrompt` restores the
 * retrieval -> generation content path.
 */

// Mock heavy constructor dependencies so ExecutionLayer can be instantiated in isolation.
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("@server/services/core/confidence-guardrail.service", () => ({
  ConfidenceGuardrailService: class {},
}));
jest.mock("@server/services/core/company-interest-guardrail.service", () => ({
  CompanyInterestGuardrailService: class {},
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

// Mock the document repository used via dynamic import inside buildKnowledgePrompt.
const findById = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: { findById: (id: string) => findById(id) },
}));

import { ExecutionLayer } from "../../orchestrator/execution.layer";

type Buildable = { buildKnowledgePrompt: (conversation: unknown) => Promise<string> };

describe("ExecutionLayer.buildKnowledgePrompt (document RAG injection)", () => {
  let layer: ExecutionLayer;

  beforeEach(() => {
    findById.mockReset();
    layer = new ExecutionLayer();
  });

  const build = (conversation: unknown) =>
    (layer as unknown as Buildable).buildKnowledgePrompt(conversation);

  it("injects attached document content into the prompt", async () => {
    findById.mockImplementation(async (id: string) =>
      id === "doc-1"
        ? { id, title: "Return Policy", content: "Returns accepted within 30 days." }
        : null,
    );

    const block = await build({ document_ids: ["doc-1"] });

    expect(block).toContain("KNOWLEDGE BASE");
    expect(block).toContain("Return Policy");
    expect(block).toContain("Returns accepted within 30 days.");
  });

  it("returns an empty string when no documents are attached", async () => {
    expect(await build({ document_ids: [] })).toBe("");
    expect(await build({ document_ids: undefined })).toBe("");
    expect(findById).not.toHaveBeenCalled();
  });

  it("skips documents that fail to load or have no content", async () => {
    findById.mockImplementation(async (id: string) =>
      id === "doc-ok" ? { id, title: "Ok", content: "usable" } : null,
    );

    const block = await build({ document_ids: ["doc-missing", "doc-ok"] });

    expect(block).toContain("usable");
    expect(block).not.toContain("doc-missing");
  });

  it("truncates oversized document content", async () => {
    findById.mockResolvedValue({ id: "doc-1", title: "Big", content: "x".repeat(9000) });

    const block = await build({ document_ids: ["doc-1"] });

    expect(block).toContain("...");
    // 8000-char cap + framing, well under the original 9000.
    expect(block.length).toBeLessThan(8600);
  });
});
