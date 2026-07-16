import { sanitizeRevisedMarkdown } from "../../services/playbook-suggestion.service";

describe("sanitizeRevisedMarkdown", () => {
  const currentMarkdown = [
    "This playbook is designed to guide the AI support agent.",
    "",
    "# Step 1: Greeting",
    "",
    "- Greet the customer warmly.",
  ].join("\n");

  it("returns clean output unchanged", () => {
    const revised = currentMarkdown + "\n- Acknowledge the refund request.";
    expect(sanitizeRevisedMarkdown(revised, currentMarkdown)).toBe(revised);
  });

  it("extracts the document when the model echoes the sentinels", () => {
    const revised = `<<<BEGIN_PLAYBOOK>>>\n${currentMarkdown}\n<<<END_PLAYBOOK>>>`;
    expect(sanitizeRevisedMarkdown(revised, currentMarkdown)).toBe(currentMarkdown);
  });

  it("strips an echoed prompt preamble and trailing allowlist", () => {
    const revised = [
      "## Playbook: Refund Request Handling",
      "",
      "Trigger: Customer wants a refund.",
      "",
      "## Current Instructions",
      "",
      "The instructions below are the current version.",
      "",
      currentMarkdown,
      "",
      "## Available Actions (allowlist)",
      "",
      "- **Find Customer**: token `<<action:hay-plugin-shopify:shopify_find_customer>>`",
    ].join("\n");

    expect(sanitizeRevisedMarkdown(revised, currentMarkdown)).toBe(currentMarkdown);
  });

  it("strips echoed conversation and task sections", () => {
    const revised = `${currentMarkdown}\n\n## Your Task\n\nReturn a JSON object.`;
    expect(sanitizeRevisedMarkdown(revised, currentMarkdown)).toBe(currentMarkdown);
  });

  it("keeps a legitimately edited first paragraph when no scaffolding is echoed", () => {
    const revised = currentMarkdown.replace(
      "This playbook is designed to guide the AI support agent.",
      "This playbook guides the AI support agent through refunds.",
    );
    expect(sanitizeRevisedMarkdown(revised, currentMarkdown)).toBe(revised);
  });
});
