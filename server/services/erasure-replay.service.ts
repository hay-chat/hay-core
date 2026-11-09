import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import { createLogger } from "@server/lib/logger";
import { organizationService } from "./organization.service";
import { privacyService } from "./privacy.service";
import type { ErasureSubjectType } from "./erasure-ledger";

const logger = createLogger("erasure-replay");

export interface PendingErasure {
  subjectType: ErasureSubjectType;
  subjectId: string;
  organizationId: string | null;
}

export interface ErasureReplayReport {
  pending: PendingErasure[];
  applied: number;
  failed: number;
}

/** Erased subjects that exist again, organizations first: their deletion covers the rest. */
export async function findPendingErasures(): Promise<PendingErasure[]> {
  const rows: Array<{
    subject_type: ErasureSubjectType;
    subject_id: string;
    organization_id: string | null;
  }> = await AppDataSource.query(
    `SELECT l.subject_type, l.subject_id, l.organization_id
     FROM erasure_ledger l
     WHERE (l.subject_type = 'organization'
            AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = l.subject_id))
        OR (l.subject_type = 'customer'
            AND EXISTS (SELECT 1 FROM customers c
                        WHERE c.id = l.subject_id AND c.organization_id = l.organization_id))
        OR (l.subject_type = 'user'
            AND EXISTS (SELECT 1 FROM users u
                        WHERE u.id = l.subject_id AND u.email NOT LIKE 'deleted-%@deleted.local'))
     ORDER BY CASE l.subject_type WHEN 'organization' THEN 0 WHEN 'user' THEN 1 ELSE 2 END,
              l.erased_at`,
  );
  return rows.map((row) => ({
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    organizationId: row.organization_id,
  }));
}

/**
 * Apply every recorded erasure again after a restore. Lists what it would do
 * unless `apply` is set; safe to run repeatedly, since an erased subject stops
 * being pending.
 */
export async function replayErasures(options: { apply: boolean }): Promise<ErasureReplayReport> {
  const pending = await findPendingErasures();
  const report: ErasureReplayReport = { pending, applied: 0, failed: 0 };
  if (!options.apply) return report;

  for (const erasure of pending) {
    try {
      await applyErasure(erasure);
      report.applied++;
    } catch (error) {
      report.failed++;
      logger.error(
        { err: error, subjectType: erasure.subjectType, subjectId: erasure.subjectId },
        "Failed to replay an erasure",
      );
    }
  }
  return report;
}

async function applyErasure(erasure: PendingErasure): Promise<void> {
  switch (erasure.subjectType) {
    case "organization": {
      const organization = await AppDataSource.getRepository(Organization).findOneBy({
        id: erasure.subjectId,
      });
      // Already gone when a previous entry's cascade covered it.
      if (organization) {
        await organizationService.deleteWithData(organization, { source: "operator" });
      }
      return;
    }
    case "user":
      await privacyService.eraseUser(erasure.subjectId);
      return;
    case "customer":
      await privacyService.eraseCustomer(erasure.subjectId, erasure.organizationId!);
      return;
  }
}
