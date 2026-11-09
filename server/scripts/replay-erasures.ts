#!/usr/bin/env node
/**
 * Apply every recorded erasure (erasure_ledger) again. Run after restoring a
 * database backup: anyone erased since the backup was taken would otherwise
 * come back. Lists what it would do unless --apply is passed; safe to run again.
 *
 *   npm run privacy:replay-erasures            # dry run
 *   npm run privacy:replay-erasures -- --apply
 */
import { AppDataSource } from "../database/data-source";
import { replayErasures } from "../services/erasure-replay.service";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  await AppDataSource.initialize();

  const report = await replayErasures({ apply });
  for (const erasure of report.pending) {
    console.log(`${erasure.subjectType}\t${erasure.subjectId}\t${erasure.organizationId ?? "-"}`);
  }
  console.log(
    apply
      ? `Applied ${report.applied} erasures, ${report.failed} failed.`
      : `${report.pending.length} erasures pending. Pass --apply to run them.`,
  );

  await AppDataSource.destroy();
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
