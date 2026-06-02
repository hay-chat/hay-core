/**
 * Verify the Jira half of the Atlassian plugin against the real API.
 * Mirrors verify-router.ts but exercises JiraClient + the same auth path.
 *
 * Run: npx tsx scripts/verify-jira.ts
 */

import * as fs from "fs";
import * as path from "path";
import { JiraClient } from "../src/jira-client";

async function main() {
  const tokenPath = path.resolve(__dirname, "../../../../atlassian token.txt");
  if (!fs.existsSync(tokenPath)) {
    console.error("Token file not found at", tokenPath);
    process.exit(1);
  }
  const apiToken = fs.readFileSync(tokenPath, "utf8").trim();

  const client = new JiraClient({
    mode: "basic",
    email: "roger@hay.chat",
    siteUrl: "https://hay-team.atlassian.net",
    apiToken,
  });

  console.log("=== whoami ===");
  const me = await client.whoami();
  console.log({ accountId: me.accountId, displayName: me.displayName });

  console.log("\n=== listProjects ===");
  const projects = await client.listProjects({ limit: 10 });
  console.log(`total=${projects.total}`);
  for (const p of projects.values.slice(0, 5)) {
    console.log(`  ${p.key.padEnd(8)} ${p.name}`);
  }

  if (projects.values.length === 0) {
    console.log("(no Jira projects visible — token may not have Jira scope)");
    return;
  }

  console.log("\n=== searchIssues (recent across all projects) ===");
  const recent = await client.searchIssues({
    jql: "created >= -180d ORDER BY updated DESC",
    maxResults: 5,
  });
  console.log(`total=${recent.total}`);
  for (const iss of recent.issues) {
    console.log(
      `  ${iss.key.padEnd(12)} [${iss.fields.status?.name ?? "?"}] ${iss.fields.summary}`,
    );
  }

  if (recent.issues[0]) {
    console.log("\n=== getIssue ===");
    const full = await client.getIssue(recent.issues[0].key);
    console.log({
      key: full.key,
      summary: full.fields.summary,
      status: full.fields.status?.name,
      assignee: full.fields.assignee?.displayName,
    });
  }

  console.log("\n=== verify-jira PASSED ===");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
