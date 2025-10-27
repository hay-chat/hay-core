import { describe, it, expect, beforeEach } from "@jest/globals";
import { PromptService } from "../../services/prompt.service";
import { VariableEngine } from "../../utils/variable-engine";
import { PromptParser } from "../../utils/prompt-parser";

describe("PromptService", () => {
  let promptService: PromptService;

  beforeEach(() => {
    promptService = PromptService.getInstance();
  });

  describe("Variable Engine", () => {
    it("should replace simple variables", () => {
      const template = "Hello {{name}}, welcome to {{place}}!";
      const variables = { name: "John", place: "Hay" };
      const result = VariableEngine.render(template, variables);
      expect(result).toBe("Hello John, welcome to Hay!");
    });

    it("should handle conditionals", () => {
      const template = "{{#if premium}}You are a premium user!{{else}}Consider upgrading.{{/if}}";
      const result1 = VariableEngine.render(template, { premium: true });
      expect(result1).toBe("You are a premium user!");

      const result2 = VariableEngine.render(template, { premium: false });
      expect(result2).toBe("Consider upgrading.");
    });

    it("should handle loops", () => {
      const template = "Items: {{#each items}}- {{item}}\n{{/each}}";
      const variables = { items: ["apple", "banana", "orange"] };
      const result = VariableEngine.render(template, variables);
      expect(result).toBe("Items: - apple\n- banana\n- orange\n");
    });

    it("should handle default values", () => {
      const template = 'Hello {{name|default:"Guest"}}!';
      const result1 = VariableEngine.render(template, { name: "Alice" });
      expect(result1).toBe("Hello Alice!");

      const result2 = VariableEngine.render(template, {});
      expect(result2).toBe("Hello Guest!");
    });

    it("should handle nested objects", () => {
      const template = "User: {{user.name}} ({{user.email}})";
      const variables = {
        user: {
          name: "Bob",
          email: "bob@example.com",
        },
      };
      const result = VariableEngine.render(template, variables);
      expect(result).toBe("User: Bob (bob@example.com)");
    });
  });

  describe("Prompt Parser", () => {
    it("should parse frontmatter correctly", () => {
      const content = `---
id: test-prompt
name: Test Prompt
description: A test prompt
version: 1.0.0
---

This is the prompt content with {{variable}}.`;

      const parsed = PromptParser.parsePromptContent(content, "default-id");

      expect(parsed.metadata.id).toBe("test-prompt");
      expect(parsed.metadata.name).toBe("Test Prompt");
      expect(parsed.metadata.description).toBe("A test prompt");
      expect(parsed.metadata.version).toBe("1.0.0");
      expect(parsed.variables).toContain("variable");
      expect(parsed.content).toContain("This is the prompt content");
    });

    it("should extract variables from content", () => {
      const content = `
{{simple}}
{{#if conditional}}{{nested}}{{/if}}
{{#each items}}{{item}}{{/each}}
{{object.property}}
{{withDefault|default:"fallback"}}
`;

      const parsed = PromptParser.parsePromptContent(content, "test");

      expect(parsed.variables).toContain("simple");
      expect(parsed.variables).toContain("conditional");
      expect(parsed.variables).toContain("nested");
      expect(parsed.variables).toContain("items");
      expect(parsed.variables).toContain("object");
      expect(parsed.variables).toContain("withDefault");
    });
  });
});

// Run a simple test manually
async function manualTest() {
  console.log("🧪 Testing Prompt Service...\n");

  // Test Variable Engine
  console.log("1. Testing Variable Engine:");
  const template =
    "Hello {{name}}, you have {{#if messages}}{{messages.length}} new messages{{else}}no new messages{{/if}}.";
  const result1 = VariableEngine.render(template, {
    name: "Alice",
    messages: ["msg1", "msg2"],
  });
  console.log("   Result:", result1);
  console.log("   Expected: Hello Alice, you have 2 new messages.");
  console.log("   ✅ Pass:", result1 === "Hello Alice, you have 2 new messages.\n");

  // Test Prompt Parser
  console.log("\n2. Testing Prompt Parser:");
  const promptContent = `---
id: greeting
name: Greeting Prompt
---
Hello {{user}}!`;
  const parsed = PromptParser.parsePromptContent(promptContent, "default");
  console.log("   Metadata:", parsed.metadata);
  console.log("   Variables:", parsed.variables);
  console.log(
    "   ✅ Pass:",
    parsed.metadata.id === "greeting" && parsed.variables.includes("user"),
  );

  console.log("\n✨ All manual tests completed!");
}

// Run manual test if this file is executed directly
if (require.main === module) {
  manualTest().catch(console.error);
}
