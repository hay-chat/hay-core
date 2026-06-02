/**
 * Verify the Confluence plugin's effective router surface against the REAL
 * Atlassian API. Exercises the same code paths the sync engine will use:
 *   - listSpaces
 *   - listPagesInSpace
 *   - getPage + adfToMarkdown
 *
 * Run from the plugin dir:
 *   cd plugins/core/confluence && npx tsx scripts/verify-router.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfluenceClient, type ConfluenceSpace } from "../src/confluence-client.js";
import { adfToMarkdown } from "../src/adf-to-markdown.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TOKEN_FILE = path.join(REPO_ROOT, "atlassian token.txt");

function loadToken(): string {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Token file not found: ${TOKEN_FILE}`);
  }
  const raw = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!raw) {
    throw new Error(`Token file is empty: ${TOKEN_FILE}`);
  }
  return raw;
}

async function main(): Promise<void> {
  const token = loadToken();
  const client = new ConfluenceClient({
    mode: "basic",
    email: "roger@hay.chat",
    siteUrl: "https://hay-team.atlassian.net",
    apiToken: token,
  });

  console.log("=== listSpaces ===");
  // Pull a larger page of spaces so we can hunt for one with pages
  const { results: spaces } = await client.listSpaces({ limit: 25 });
  console.log(`spaces returned: ${spaces.length}`);
  console.log(spaces.slice(0, 10).map((s) => ({ id: s.id, key: s.key, name: s.name })));
  if (spaces.length === 0) {
    console.error("No spaces returned");
    process.exit(1);
  }

  // Walk spaces in order until we find one with at least one page.
  console.log("\n=== listPagesInSpace (walking spaces until a non-empty one) ===");
  let chosenSpace: ConfluenceSpace | undefined;
  let chosenPages: Awaited<ReturnType<typeof client.listPagesInSpace>>["results"] = [];
  for (const sp of spaces) {
    const { results } = await client.listPagesInSpace({ spaceId: sp.id, limit: 5 });
    console.log(`  space ${sp.id} (${sp.key} - "${sp.name}"): ${results.length} page(s)`);
    if (results.length > 0) {
      chosenSpace = sp;
      chosenPages = results;
      break;
    }
  }
  if (!chosenSpace || chosenPages.length === 0) {
    console.error("No space has any pages - cannot exercise getPage");
    process.exit(1);
  }
  console.log(`\nUsing space id=${chosenSpace.id} key=${chosenSpace.key}`);
  console.log(
    chosenPages.map((p) => ({
      id: p.id,
      title: p.title,
      modified: p.version?.modifiedAt,
    })),
  );

  const firstPage = chosenPages[0];

  console.log("\n=== getPage + adfToMarkdown ===");
  const full = await client.getPage({ pageId: firstPage.id });
  const adfJson = full.body?.atlas_doc_format?.value;
  if (!adfJson) {
    console.error("No ADF body returned for first page");
    process.exit(1);
  }
  let adf: unknown;
  try {
    adf = JSON.parse(adfJson);
  } catch (err) {
    console.error("Failed to JSON.parse ADF body:", (err as Error).message);
    process.exit(1);
  }
  // adfToMarkdown signature accepts an AdfDocument; cast through unknown
  const md = adfToMarkdown(adf as Parameters<typeof adfToMarkdown>[0]);
  console.log(`Markdown length: ${md.length}`);
  console.log("First 500 chars:");
  console.log(md.slice(0, 500));

  if (md.trim().length === 0) {
    console.error("Markdown is empty - ADF conversion failed");
    process.exit(1);
  }

  console.log("\n=== verify-router PASSED ===");
}

main().catch((err) => {
  console.error("verify-router FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
