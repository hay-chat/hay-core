import { tiptapDocumentToMarkdown } from "../../utils/tiptap-document-markdown";
import { KnowledgeSuggestionService } from "../../services/knowledge-suggestion.service";
import { PromptService } from "../../services/prompt.service";
import { SupportedLanguage } from "../../types/language.types";
import { sanitizeRevisedMarkdown } from "../../services/playbook-suggestion.service";

const text = (value: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

describe("tiptapDocumentToMarkdown", () => {
  it("converts the editor's nodes and marks, keeping links verbatim", () => {
    const markdown = tiptapDocumentToMarkdown({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text("Returns")] },
        {
          type: "paragraph",
          content: [
            text("Start a return "),
            text("here", [{ type: "link", attrs: { href: "https://shop.example/returns?a=1" } }]),
            text(" within "),
            text("30 days", [{ type: "bold" }]),
            text("."),
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("Unworn")] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [text("Tags on")] }] },
          ],
        },
        { type: "paragraph" },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [text("Pack it")] }] },
          ],
        },
      ],
    });
    expect(markdown).toBe(
      [
        "## Returns",
        "Start a return [here](https://shop.example/returns?a=1) within **30 days**.",
        "- Unworn\n- Tags on",
        "1. Pack it",
      ].join("\n\n"),
    );
  });

  it("returns null for content that would not survive the round trip", () => {
    const nestedList = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [text("a")] },
                { type: "bulletList", content: [] },
              ],
            },
          ],
        },
      ],
    };
    expect(tiptapDocumentToMarkdown(nestedList)).toBeNull();
    expect(tiptapDocumentToMarkdown({ type: "doc", content: [{ type: "table" }] })).toBeNull();
    expect(tiptapDocumentToMarkdown(null)).toBeNull();
  });
});

describe("KnowledgeSuggestionService.toResult", () => {
  const service = new KnowledgeSuggestionService();
  const updatedAt = new Date("2026-10-01T10:00:00Z");
  const candidates = [
    { id: "doc-1", title: "Shipping", editable: true, markdown: "Ships in 3 days.", updatedAt },
    { id: "doc-2", title: "Synced FAQ", editable: false, markdown: "Imported.", updatedAt },
  ];
  const base = { analysis: "Because.", changes: [], noChangesNeeded: false };

  it("returns an edit of an editable candidate with its current text", () => {
    const result = service.toResult(
      {
        ...base,
        mode: "edit",
        documentId: "doc-1",
        title: "x",
        revisedContent:
          "```markdown\n<<<BEGIN_DOCUMENT>>>\nShips in 2 days.\n<<<END_DOCUMENT>>>\n```",
      },
      candidates,
      false,
    );
    expect(result).toMatchObject({
      mode: "edit",
      documentId: "doc-1",
      title: "Shipping",
      currentMarkdown: "Ships in 3 days.",
      revisedMarkdown: "Ships in 2 days.",
      baseUpdatedAt: updatedAt.toISOString(),
      noChangesNeeded: false,
    });
  });

  it("never edits a read-only document, and does not turn that edit into a new document", () => {
    const result = service.toResult(
      { ...base, mode: "edit", documentId: "doc-2", title: "x", revisedContent: "Changed." },
      candidates,
      false,
    );
    expect(result.mode).toBe("add");
    expect(result.noChangesNeeded).toBe(true);
    expect(result.revisedMarkdown).toBe("");
  });

  it("returns a new Q&A with an empty base", () => {
    const result = service.toResult(
      {
        ...base,
        mode: "add",
        documentId: "",
        title: "Do you ship to Portugal?",
        revisedContent: "Yes, in 5 days.",
      },
      candidates,
      false,
    );
    expect(result).toMatchObject({
      mode: "add",
      documentId: null,
      title: "Do you ship to Portugal?",
      currentMarkdown: "",
      revisedMarkdown: "Yes, in 5 days.",
      noChangesNeeded: false,
    });
  });

  it("refuses a new Q&A when only the given document may change", () => {
    const result = service.toResult(
      { ...base, mode: "add", documentId: "", title: "Q?", revisedContent: "A." },
      candidates,
      true,
    );
    expect(result.noChangesNeeded).toBe(true);
  });
});

describe("Improve prompts", () => {

  it.each(["en", "pt"])("renders the knowledge prompt with documents and feedback (%s)", async (lang) => {
    const prompt: string = await PromptService.getInstance().getPrompt(
      "knowledge/suggest-edits",
      {
        transcript: "Customer: Do you ship to Portugal?",
        feedback: "Mention Portugal",
        documentOnly: "",
        documents: [{ id: "doc-1", title: "Shipping", editable: "yes", content: "Ships in 3 days." }],
      },
      { language: lang === "pt" ? SupportedLanguage.PORTUGUESE : SupportedLanguage.ENGLISH },
    );
    expect(prompt).toContain("Document id: doc-1");
    expect(prompt).toContain("Ships in 3 days.");
    expect(prompt).toContain("Mention Portugal");
    expect(prompt).not.toContain("{{");
    if (lang === "pt") expect(prompt).toContain("Sua Tarefa");
  });

  it("has Portuguese playbook prompts, and strips their echoed headings", async () => {
    const pt = { language: SupportedLanguage.PORTUGUESE };
    const suggest: string = await PromptService.getInstance().getPrompt(
      "playbook/suggest-edits",
      { playbookTitle: "Trocas", playbookTrigger: "t", currentInstructions: "# Passo 1", transcript: "", feedback: "f", selection: "", actions: [], documents: [] },
      pt,
    );
    expect(suggest).toContain("Instruções Atuais");
    const generate: string = await PromptService.getInstance().getPrompt(
      "playbook/generate-instructions",
      { purpose: "Trocas", actions: [], documents: [] },
      pt,
    );
    expect(generate).toContain("português do Brasil");

    const current = "# Passo 1\n- Cumprimente o cliente.";
    expect(sanitizeRevisedMarkdown(`${current}\n\n## Sua Tarefa\n\nRetorne JSON.`, current)).toBe(current);
  });
});
