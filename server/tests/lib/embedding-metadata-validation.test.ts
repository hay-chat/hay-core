import { describe, it, expect } from "@jest/globals";
import { embeddingChunkMetadata } from "@server/lib/validation/json-record";

describe("embeddingChunkMetadata", () => {
  const schema = embeddingChunkMetadata(1024);
  const id = "a0d17000-0000-4000-8000-000000000001";

  it("accepts ordinary metadata and real ids", () => {
    expect(schema.safeParse({ page: 1, conversationId: id, messageId: id }).success).toBe(true);
  });

  it.each(["conversationId", "messageId"])("rejects a %s that is not a UUID", (key) => {
    expect(schema.safeParse({ [key]: "not-a-uuid" }).success).toBe(false);
    expect(schema.safeParse({ [key]: 5 }).success).toBe(false);
  });
});
