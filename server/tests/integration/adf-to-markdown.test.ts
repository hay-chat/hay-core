import { describe, it, expect } from "@jest/globals";
import { adfToMarkdown, type AdfDocument } from "@plugins/core/confluence/src/adf-to-markdown";

describe("adfToMarkdown", () => {
  it("returns empty string for an empty doc", () => {
    const doc: AdfDocument = { type: "doc", version: 1, content: [] };
    expect(adfToMarkdown(doc)).toBe("");
  });

  it("returns empty string for null / undefined / malformed input", () => {
    // Defensive: never throws.
    expect(adfToMarkdown(null)).toBe("");
    expect(adfToMarkdown(undefined)).toBe("");
    // @ts-expect-error - intentionally malformed
    expect(adfToMarkdown({ type: "doc", version: 1 })).toBe("");
  });

  it("renders a heading followed by a paragraph", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Some body text." }],
        },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("## Title");
    expect(out).toContain("Some body text.");
    // Heading precedes paragraph
    expect(out.indexOf("## Title")).toBeLessThan(out.indexOf("Some body text."));
  });

  it("renders a bullet list with 3 items", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Second" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Third" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("- First");
    expect(out).toContain("- Second");
    expect(out).toContain("- Third");
  });

  it("renders a code block with language", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("```typescript");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("```");
  });

  it("renders a paragraph with strong, em, code, and link marks", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "strong" }] },
            { type: "text", text: " " },
            { type: "text", text: "italic", marks: [{ type: "em" }] },
            { type: "text", text: " " },
            { type: "text", text: "code", marks: [{ type: "code" }] },
            { type: "text", text: " " },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("**bold**");
    expect(out).toContain("_italic_");
    expect(out).toContain("`code`");
    expect(out).toContain("[link](https://example.com)");
  });

  it("renders a GFM table with a header row and two data rows", () => {
    const cell = (
      text: string,
      isHeader = false,
    ): import("@plugins/core/confluence/src/adf-to-markdown").AdfNode => ({
      type: isHeader ? "tableHeader" : "tableCell",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    });

    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("Name", true), cell("Age", true)],
            },
            {
              type: "tableRow",
              content: [cell("Alice"), cell("30")],
            },
            {
              type: "tableRow",
              content: [cell("Bob"), cell("25")],
            },
          ],
        },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("| Name | Age |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| Alice | 30 |");
    expect(out).toContain("| Bob | 25 |");
    // Header line precedes separator precedes body.
    expect(out.indexOf("| Name | Age |")).toBeLessThan(out.indexOf("| --- | --- |"));
    expect(out.indexOf("| --- | --- |")).toBeLessThan(out.indexOf("| Alice | 30 |"));
  });

  it("emits a visible placeholder for unknown node types", () => {
    const doc: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        // @ts-expect-error - intentionally unknown type
        { type: "extensionMacroXyz", attrs: { name: "mystery" } },
      ],
    };
    const out = adfToMarkdown(doc);
    expect(out).toContain("> [unsupported ADF node: extensionMacroXyz]");
  });
});
