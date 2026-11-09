import type { EntityManager } from "typeorm";

export type ErasureSubjectType = "customer" | "user" | "organization";

/**
 * Note an erasure so it can be applied again if a backup is ever restored
 * (scripts/replay-erasures.ts). Holds ids only, and is written in the erasure's
 * own transaction: an erasure that rolled back leaves no entry, one that
 * committed always has one.
 */
export async function recordErasure(
  manager: EntityManager,
  entry: { subjectType: ErasureSubjectType; subjectId: string; organizationId?: string },
): Promise<void> {
  await manager.query(
    `INSERT INTO erasure_ledger (subject_type, subject_id, organization_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject_type, subject_id) DO NOTHING`,
    [entry.subjectType, entry.subjectId, entry.organizationId ?? null],
  );
}
