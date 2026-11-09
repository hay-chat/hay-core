#!/usr/bin/env node
/**
 * Audit log external sink.
 *
 *   npm run audit:sink -- verify         compare the sink with audit_logs; exits 1 on any mismatch
 *   npm run audit:sink -- status         queue depth, oldest waiting entry, entries set aside
 *   npm run audit:sink -- retry-failed   queue set-aside entries again
 */
import { AppDataSource } from "../database/data-source";
import { auditSinkService } from "../services/audit-sink.service";
import { auditLogService } from "../services/audit-log.service";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!["verify", "status", "retry-failed"].includes(command)) {
    console.error("Usage: audit-sink <verify|status|retry-failed>");
    process.exit(2);
  }
  if (!auditSinkService.enabled) {
    console.error("The audit log sink is not configured (set AUDIT_SINK_BUCKET).");
    process.exit(2);
  }
  await AppDataSource.initialize();
  try {
    if (command === "status") {
      console.log(JSON.stringify(await auditSinkService.status()));
    } else if (command === "retry-failed") {
      console.log(`Queued ${await auditSinkService.requeueFailed()} entries again.`);
    } else {
      const chainProblems = await auditLogService.verifyChain();
      const report = await auditSinkService.verify();
      for (const p of chainProblems)
        console.log(`chain\t${p.chainKey}\t${p.chainSeq}\t${p.problem}`);
      for (const p of report.problems)
        console.log(`sink\t${p.chainKey}\t${p.chainSeq}\t${p.problem}`);
      console.log(
        `${report.checked} rows compared, ${report.pending} not shipped yet, ` +
          `${report.problems.length} sink problems, ${chainProblems.length} chain problems.`,
      );
      if (report.problems.length > 0 || chainProblems.length > 0) process.exitCode = 1;
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
