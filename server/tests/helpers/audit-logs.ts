import { AppDataSource } from "@server/database/data-source";

/**
 * Test cleanup for audit_logs. The table is append-only (guard trigger); a
 * DELETE only passes inside a transaction that set the retention purge flag.
 */
export async function purgeAuditLogs(where: string, params: unknown[] = []): Promise<void> {
  await AppDataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('hay.audit_logs_purge', 'on', true)`);
    await manager.query(`DELETE FROM audit_logs WHERE ${where}`, params);
  });
}
