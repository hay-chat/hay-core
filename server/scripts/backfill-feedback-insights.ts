#!/usr/bin/env node
/**
 * D3-9: create the insight issue for every message_feedback row that has
 * none (ratings saved before feedback fed Insights). The issues are created
 * pending; the `insight-feedback-enrichment` job explains them (one
 * easy-tier LLM call each, up to 5 every 10 s) and `insight-embeddings`
 * embeds them. Safe to run again (unique feedback id).
 *
 *   npm run insights:backfill-feedback                 # every organization
 *   npm run insights:backfill-feedback -- <org-uuid>   # one organization
 */
import { AppDataSource } from "../database/data-source";
import { feedbackInsightService } from "../services/insights/feedback-insight.service";

async function main() {
  const organizationId = process.argv[2];
  await AppDataSource.initialize();
  const { created, skipped } = await feedbackInsightService.backfillMissing({ organizationId });
  console.log(
    `Created ${created} feedback insight issues; skipped ${skipped} ratings of messages outside their organization.`,
  );
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error("Feedback insight backfill failed:", error);
  process.exit(1);
});
