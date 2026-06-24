/**
 * Global Test Setup
 * Runs before all tests
 */
import { jest, beforeAll, afterAll } from "@jest/globals";
import { OpenAICompatibleProvider } from "../services/llm/openai-compatible.provider";
import type { EmbeddingRequest, EmbeddingResult } from "../services/llm/provider.types";

// Set test environment
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";

/**
 * Stub the embedding network call so integration tests are hermetic — they
 * exercise the real factory, dimension assertion, and pgvector writes, but
 * never hit OpenAI (CI has no real key, which previously 401'd every test that
 * embeds). The vector is a deterministic, content-seeded, non-negative unit
 * vector: identical text → identical vector (stable search results) and any two
 * vectors have cosine similarity in (0, 1], satisfying the search assertions.
 */
jest.spyOn(OpenAICompatibleProvider.prototype, "embed").mockImplementation(async function (
  this: OpenAICompatibleProvider,
  req: EmbeddingRequest,
): Promise<EmbeddingResult> {
  const dims = this.dimensions;
  const inputs = Array.isArray(req.input) ? req.input : [req.input];

  const embeddings = inputs.map((text) => {
    // FNV-1a hash → fills every dimension with a positive value, so the dot
    // product of any two vectors is strictly positive (cosine similarity > 0).
    const vec = new Array<number>(dims);
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      let h = 2166136261 ^ i;
      for (let c = 0; c < text.length; c++) {
        h = Math.imul(h ^ text.charCodeAt(c), 16777619);
      }
      const v = ((h >>> 0) % 1000) / 1000 + 0.001; // (0, 1], never zero
      vec[i] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    return vec.map((v) => v / norm);
  });

  return {
    embeddings,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true },
    model: req.model,
    provider: this.id,
    dimensions: dims,
  };
});

// Mock console methods to reduce noise during tests (optional)
// Uncomment if you want cleaner test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
// };

// Global test timeout
jest.setTimeout(30000); // 30 seconds

// Global setup
beforeAll(() => {
  console.log("🧪 Starting test suite...");
});

// Global teardown
afterAll(() => {
  console.log("✅ Test suite complete!");
});
