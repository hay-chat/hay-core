import { describe, it, expect } from "vitest";

import {
  extractCustomerFields,
  findMissingRequiredFields,
  formSchemaSchema,
  renderFormResponseAsText,
  validateResponse,
  type FormSchema,
} from "./index.js";

const sample: FormSchema = {
  id: "pre-chat",
  title: "Welcome",
  fields: [
    { name: "name", label: "Name", type: "text", required: true, mapToCustomer: "name" },
    { name: "email", label: "Email", type: "email", required: true, mapToCustomer: "email" },
    {
      name: "topic",
      label: "Topic",
      type: "select",
      required: true,
      options: [
        { value: "billing", label: "Billing" },
        { value: "tech", label: "Technical" },
      ],
    },
    { name: "subscribe", label: "Subscribe", type: "checkbox" },
  ],
};

describe("formSchemaSchema", () => {
  it("accepts a valid schema", () => {
    expect(() => formSchemaSchema.parse(sample)).not.toThrow();
  });

  it("rejects duplicate field names", () => {
    const dup = {
      ...sample,
      fields: [...sample.fields, { name: "name", label: "Name 2", type: "text" }],
    };
    expect(formSchemaSchema.safeParse(dup).success).toBe(false);
  });

  it("rejects select fields with no options", () => {
    const bad = {
      ...sample,
      fields: [{ name: "x", label: "X", type: "select" as const }],
    };
    expect(formSchemaSchema.safeParse(bad).success).toBe(false);
  });
});

describe("validateResponse", () => {
  it("accepts a valid response", () => {
    const result = validateResponse(sample, {
      name: "Roger",
      email: "roger@example.com",
      topic: "billing",
      subscribe: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = validateResponse(sample, {
      name: "Roger",
      email: "not-an-email",
      topic: "billing",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.email).toBeDefined();
    }
  });

  it("rejects select value not in options", () => {
    const result = validateResponse(sample, {
      name: "Roger",
      email: "roger@example.com",
      topic: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("requires required fields", () => {
    const result = validateResponse(sample, { topic: "billing" });
    expect(result.success).toBe(false);
  });
});

describe("renderFormResponseAsText", () => {
  it("renders human-readable text with select labels", () => {
    const text = renderFormResponseAsText(sample, {
      name: "Roger",
      email: "roger@example.com",
      topic: "billing",
      subscribe: true,
    });
    expect(text).toContain("Name: Roger");
    expect(text).toContain("Email: roger@example.com");
    expect(text).toContain("Topic: Billing");
    expect(text).toContain("Subscribe: Yes");
  });
});

describe("extractCustomerFields", () => {
  it("pulls mapped fields", () => {
    const out = extractCustomerFields(sample, {
      name: "Roger",
      email: "roger@example.com",
      topic: "billing",
    });
    expect(out).toEqual({ name: "Roger", email: "roger@example.com" });
  });
});

describe("findMissingRequiredFields", () => {
  it("returns required fields missing from context", () => {
    const missing = findMissingRequiredFields(sample, { name: "Roger" });
    expect(missing).toEqual(["email", "topic"]);
  });

  it("returns empty when all required fields are present", () => {
    const missing = findMissingRequiredFields(sample, {
      name: "Roger",
      email: "r@e.com",
      topic: "billing",
    });
    expect(missing).toEqual([]);
  });
});
