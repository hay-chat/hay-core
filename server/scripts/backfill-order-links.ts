#!/usr/bin/env node
/**
 * D2-4: index orders named in existing messages (tool calls and "#1001"-style
 * mentions) into order_conversation_links. Safe to run again (unique index).
 *
 *   npm run order-links:backfill                 # every organization
 *   npm run order-links:backfill -- <org-uuid>   # one organization
 */
import { AppDataSource } from "../database/data-source";
import { orderLinkService } from "../services/order-links/order-link.service";

async function main() {
  const organizationId = process.argv[2];
  await AppDataSource.initialize();
  const scanned = await orderLinkService.backfill({ organizationId });
  const [{ count }] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS count FROM order_conversation_links`,
  );
  console.log(`Scanned ${scanned} messages; ${count} order links in total.`);
  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error("Order link backfill failed:", error);
  process.exit(1);
});
