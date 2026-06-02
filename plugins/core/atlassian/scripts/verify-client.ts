/**
 * Verify ConfluenceClient against the real Atlassian API.
 *
 * Reads the API token from `<repo>/atlassian token.txt`. Do NOT commit
 * any output that captures the token verbatim.
 *
 * Run from the repo root or this plugin dir:
 *   cd plugins/core/confluence && npx tsx scripts/verify-client.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfluenceClient } from "../src/confluence-client.js";

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

function maskToken(t: string): string {
  if (t.length <= 8) return "***";
  return `${t.slice(0, 4)}...${t.slice(-4)} (len=${t.length})`;
}

async function main(): Promise<void> {
  const apiToken = loadToken();
  const email = "roger@hay.chat";
  const siteUrl = "https://hay-team.atlassian.net";

  console.log("=== ConfluenceClient verification ===");
  console.log(`Site:  ${siteUrl}`);
  console.log(`Email: ${email}`);
  console.log(`Token: ${maskToken(apiToken)}`);
  console.log("");

  const client = new ConfluenceClient({ mode: "basic", email, apiToken, siteUrl });

  // 1) ping
  console.log("[1] ping()");
  const ping = await client.ping();
  console.log("    result:", ping);
  if (!ping.ok) {
    throw new Error(`ping failed: ${ping.error}`);
  }
  console.log("");

  // 2) listSpaces
  console.log("[2] listSpaces({ limit: 5 })");
  const spaces = await client.listSpaces({ limit: 5 });
  console.log(`    spaces returned: ${spaces.results.length}`);
  console.log(`    nextCursor: ${spaces.nextCursor ?? "(none)"}`);
  if (spaces.results.length === 0) {
    console.log("    No spaces accessible to this user - stopping verification.");
    return;
  }
  const firstSpace = spaces.results[0];
  console.log(
    `    first space: id=${firstSpace.id} key=${firstSpace.key} name="${firstSpace.name}"`,
  );
  console.log("");

  // 3) listPagesInSpace
  console.log(`[3] listPagesInSpace({ spaceId: ${firstSpace.id}, limit: 5 })`);
  const pages = await client.listPagesInSpace({ spaceId: firstSpace.id, limit: 5 });
  console.log(`    pages returned: ${pages.results.length}`);
  console.log(`    nextCursor: ${pages.nextCursor ?? "(none)"}`);
  if (pages.results.length === 0) {
    console.log("    No pages in this space - stopping verification.");
    return;
  }
  const firstPage = pages.results[0];
  console.log(
    `    first page: id=${firstPage.id} title="${firstPage.title}" version=${firstPage.version?.number} modifiedAt=${firstPage.version?.modifiedAt}`,
  );
  console.log("");

  // 4) getPage
  console.log(`[4] getPage({ pageId: ${firstPage.id} })`);
  const fullPage = await client.getPage({ pageId: firstPage.id });
  const adfRaw = fullPage.body?.atlas_doc_format?.value ?? "";
  console.log(`    title:   "${fullPage.title}"`);
  console.log(`    bodyLen: ${adfRaw.length}`);
  console.log(`    bodyHead: ${adfRaw.slice(0, 200)}`);
  console.log("");

  console.log("=== Verification PASSED ===");
}

main().catch((err) => {
  console.error("Verification FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
