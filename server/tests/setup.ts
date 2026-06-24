/**
 * Global Test Setup
 * Runs before all tests
 */
import { jest, beforeAll, afterAll } from "@jest/globals";

// Set test environment
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";

/**
 * Stub the OpenAI SDK at the network boundary so integration tests are hermetic
 * — they exercise the real factory, provider, dimension assertion, and pgvector
 * writes, but never hit OpenAI (CI has no real key, which previously 401'd every
 * test that embeds). Test files that declare their OWN `jest.mock("openai")`
 * (e.g. llm-provider/llm-factory) override this — a test-file mock wins over a
 * setup-level one — so this only affects suites that don't mock OpenAI.
 *
 * The embedding vector is deterministic, content-seeded, non-negative and
 * unit-normalized: identical text → identical vector (stable search results) and
 * any two vectors have cosine similarity in (0, 1], satisfying search assertions.
 */
jest.mock("openai", () => {
  const dims = parseInt(process.env.EMBEDDING_DIM || "1536", 10);

  const makeVector = (text: string): number[] => {
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
  };

  const OpenAI = jest.fn().mockImplementation(() => ({
    embeddings: {
      create: async ({ input, model }: { input: string | string[]; model: string }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return {
          model,
          data: inputs.map((text, index) => ({ index, embedding: makeVector(text) })),
          usage: { prompt_tokens: 0, total_tokens: 0 },
        };
      },
    },
    chat: { completions: { create: jest.fn() } },
  }));

  return { __esModule: true, default: OpenAI };
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
