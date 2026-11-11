import { AppDataSource } from "../database/data-source";
import { AuditLog, type AuditAction, type AuditActorType } from "../entities/audit-log.entity";
import { User } from "../entities/user.entity";
import { createLogger } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";
import { withLongStatementTimeout } from "../database/session-limits";
import { createHmac } from "crypto";
import { apiKeyIdFromUserId } from "@server/lib/auth/api-token-actor";
import { auditSinkService } from "./audit-sink.service";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";

const logger = createLogger("audit-log");

export interface AuditLogOptions {
  /**
   * User performing the action. Optional for system-driven events
   * (e.g. scheduled syncs, plugin workers) — the audit log row stores
   * a nullable user reference. An API token's synthetic user id is accepted
   * here and recorded as the key, not as a user.
   */
  userId?: string;
  /** Set for events a plugin worker triggers; everything else is derived from `userId`. */
  actorType?: Extract<AuditActorType, "plugin" | "system">;
  organizationId?: string | null;
  action: AuditAction;
  resource?: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  status?: "success" | "failure" | "warning";
  errorMessage?: string;
}

export interface GetAuditLogsOptions {
  userId?: string;
  organizationId?: string;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/** Audit log retention promised in PRIVACY.md. */
export const AUDIT_LOG_RETENTION_DAYS = 365;
/** Network identifiers and email addresses are cleared from a row earlier than the row itself. */
export const AUDIT_LOG_PERSONAL_FIELDS_RETENTION_DAYS = 90;

const POSTGRES_UNDEFINED_FUNCTION = "42883";

function isPendingMigrationError(error: unknown): boolean {
  return (error as { code?: string }).code === POSTGRES_UNDEFINED_FUNCTION;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export interface AuditChainProblem {
  chainKey: string;
  chainSeq: string;
  problem: string;
}

/**
 * Maps the caller to the row's actor. `users.id` is a uuid, so an API token's
 * synthetic id must never reach it. The insert trigger copies the two metadata
 * keys into `actor_type` / `api_key_id`; they are overwritten here so a caller's
 * own metadata can't claim a different actor.
 */
function resolveActor(
  options: Pick<AuditLogOptions, "userId" | "actorType" | "metadata">,
): Pick<AuditLogOptions, "userId" | "metadata"> {
  const apiKeyId = apiKeyIdFromUserId(options.userId);
  const { actorType: _actorType, apiKeyId: _apiKeyId, ...rest } = options.metadata ?? {};
  const actor: Record<string, unknown> = apiKeyId
    ? { actorType: "apikey", apiKeyId }
    : options.actorType
      ? { actorType: options.actorType }
      : {};
  const metadata = { ...rest, ...actor };
  return {
    userId: apiKeyId ? undefined : options.userId,
    metadata: options.metadata || Object.keys(actor).length > 0 ? metadata : undefined,
  };
}

/** Keyed hash so failed logins for the same unknown email can be correlated without storing it. */
export function hashEmailForAudit(email: string): string {
  return createHmac("sha256", deriveServiceKey("hay:audit-email:v2"))
    .update(email.trim().toLowerCase())
    .digest("hex");
}

export class AuditLogService {
  private auditLogRepository = AppDataSource.getRepository(AuditLog);

  /**
   * Create a new audit log entry
   */
  async log(options: AuditLogOptions): Promise<AuditLog> {
    try {
      const { actorType: _actorType, ...fields } = options;
      const auditLog = AuditLog.createLog({
        ...fields,
        ...resolveActor(options),
        organizationId: options.organizationId ?? undefined,
        status: options.status || "success",
      });

      return await this.auditLogRepository.save(auditLog);
    } catch (error) {
      logger.error(
        { err: error, action: options.action, organizationId: options.organizationId },
        "Failed to create audit log",
      );
      metrics.auditWriteFailures.inc();
      throw error;
    }
  }

  /**
   * Best-effort audit write for events recorded after the action already
   * happened: a failed audit insert is logged, never surfaced to the caller.
   */
  async record(options: AuditLogOptions): Promise<void> {
    try {
      await this.log(options);
    } catch {
      // already logged by log()
    }
  }

  /**
   * Log profile update
   */
  async logProfileUpdate(
    userId: string,
    changes: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "profile.update",
      resource: "user",
      changes,
      metadata,
      status: "success",
    });
  }

  /**
   * Log email change
   */
  async logEmailChange(
    userId: string,
    oldEmail: string,
    newEmail: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "email.change",
      resource: "user",
      changes: {
        oldEmail,
        newEmail,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log password change
   */
  async logPasswordChange(userId: string, metadata?: Record<string, unknown>): Promise<AuditLog> {
    return this.log({
      userId,
      action: "password.change",
      resource: "user",
      metadata,
      status: "success",
    });
  }

  /**
   * Log password reset request
   */
  async logPasswordResetRequest(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "password.reset.request",
      resource: "auth",
      ipAddress,
      userAgent,
      metadata,
      status: "success",
    });
  }

  /**
   * Log password reset completion
   */
  async logPasswordReset(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "password.reset",
      resource: "auth",
      ipAddress,
      userAgent,
      metadata,
      status: "success",
    });
  }

  /**
   * Log user login
   */
  async logLogin(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "user.login",
      resource: "auth",
      ipAddress,
      userAgent,
      metadata,
      status: "success",
    });
  }

  /**
   * Log failed login attempt. Attempts for unknown emails are recorded
   * without a user, with a keyed hash of the email instead of the address.
   */
  async logFailedLogin(
    email: string,
    ipAddress?: string,
    userAgent?: string,
    errorMessage?: string,
  ): Promise<AuditLog | null> {
    try {
      const user = await AppDataSource.getRepository(User).findOne({
        where: { email: email.toLowerCase() },
        select: { id: true },
      });

      return await this.log({
        userId: user?.id,
        action: "user.login",
        resource: "auth",
        metadata: user ? undefined : { emailHash: hashEmailForAudit(email) },
        ipAddress,
        userAgent,
        status: "failure",
        errorMessage: errorMessage || "Invalid credentials",
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to log failed login attempt");
      return null;
    }
  }

  /**
   * Get audit logs with filters
   */
  async getLogs(options: GetAuditLogsOptions): Promise<{
    logs: AuditLog[];
    total: number;
  }> {
    const queryBuilder = this.auditLogRepository
      .createQueryBuilder("audit_log")
      .leftJoinAndSelect("audit_log.user", "user")
      .orderBy("audit_log.created_at", "DESC");

    if (options.userId) {
      queryBuilder.andWhere("audit_log.userId = :userId", {
        userId: options.userId,
      });
    }

    if (options.organizationId) {
      queryBuilder.andWhere("audit_log.organizationId = :organizationId", {
        organizationId: options.organizationId,
      });
    }

    if (options.action) {
      queryBuilder.andWhere("audit_log.action = :action", {
        action: options.action,
      });
    }

    if (options.startDate) {
      queryBuilder.andWhere("audit_log.createdAt >= :startDate", {
        startDate: options.startDate,
      });
    }

    if (options.endDate) {
      queryBuilder.andWhere("audit_log.createdAt <= :endDate", {
        endDate: options.endDate,
      });
    }

    const total = await queryBuilder.getCount();

    if (options.limit) {
      queryBuilder.limit(options.limit);
    }

    if (options.offset) {
      queryBuilder.offset(options.offset);
    }

    const logs = await queryBuilder.getMany();

    return { logs, total };
  }

  /**
   * Get recent security events for a user
   */
  async getRecentSecurityEvents(userId: string, limit: number = 10): Promise<AuditLog[]> {
    const { logs } = await this.getLogs({
      userId,
      limit,
    });

    return logs.filter((log) =>
      ["email.change", "password.change", "user.login", "apikey.create", "apikey.revoke"].includes(
        log.action,
      ),
    );
  }

  /**
   * Delete audit logs older than the retention period. Rows are append-only
   * at the database level; the purge flag set here (transaction-scoped) is
   * the only way the guard trigger allows a DELETE.
   */
  async cleanup(): Promise<number> {
    try {
      // With the sink on, rows that have not been shipped are kept; with it off
      // nothing would ever ship them, so they must not hold retention back.
      const requireShipped = auditSinkService.enabled;
      const [{ deleted }] = await withLongStatementTimeout((manager) =>
        manager.query(
          requireShipped
            ? `SELECT audit_logs_purge($1, $2, true) AS deleted`
            : `SELECT audit_logs_purge($1, $2) AS deleted`,
          [daysAgo(AUDIT_LOG_RETENTION_DAYS), daysAgo(AUDIT_LOG_PERSONAL_FIELDS_RETENTION_DAYS)],
        ),
      );
      return Number(deleted);
    } catch (error) {
      if (isPendingMigrationError(error)) {
        logger.warn("Audit log retention skipped until the migrations have run");
        return 0;
      }
      throw error;
    }
  }

  /**
   * Recomputes every hash chain and returns what doesn't match. Detects rows
   * altered or removed behind the database's guards, within what the chain covers.
   * Rewriting a whole chain and its head is caught by comparing against the
   * external copy (see AuditSinkService.verify).
   */
  async verifyChain(chainKey?: string): Promise<AuditChainProblem[]> {
    try {
      const rows: Array<{ chain_key: string; chain_seq: string; problem: string }> =
        await withLongStatementTimeout((manager) =>
          manager.query(`SELECT * FROM audit_logs_verify_chain($1)`, [chainKey ?? null]),
        );
      return rows.map((row) => ({
        chainKey: row.chain_key,
        chainSeq: row.chain_seq,
        problem: row.problem,
      }));
    } catch (error) {
      if (isPendingMigrationError(error)) return [];
      throw error;
    }
  }

  /**
   * Log organization invitation sent
   */
  async logInvitationSend(
    userId: string,
    organizationId: string,
    invitedEmail: string,
    role: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.invitation.send",
      resource: "organization_invitation",
      changes: {
        invitedEmail,
        role,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization invitation accepted
   */
  async logInvitationAccept(
    userId: string,
    organizationId: string,
    role: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.invitation.accept",
      resource: "organization_invitation",
      changes: {
        role,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization invitation declined
   */
  async logInvitationDecline(
    userId: string,
    organizationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.invitation.decline",
      resource: "organization_invitation",
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization invitation cancelled
   */
  async logInvitationCancel(
    userId: string,
    organizationId: string,
    invitedEmail: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.invitation.cancel",
      resource: "organization_invitation",
      changes: {
        invitedEmail,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization invitation resend
   */
  async logInvitationResend(
    userId: string,
    organizationId: string,
    invitedEmail: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.invitation.resend",
      resource: "organization_invitation",
      changes: {
        invitedEmail,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization member role change
   */
  async logMemberRoleChange(
    userId: string,
    organizationId: string,
    targetUserId: string,
    oldRole: string,
    newRole: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.member.role_change",
      resource: "organization_member",
      changes: {
        targetUserId,
        oldRole,
        newRole,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization member removal
   */
  async logMemberRemove(
    userId: string,
    organizationId: string,
    removedUserId: string,
    removedUserEmail: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.member.remove",
      resource: "organization_member",
      changes: {
        removedUserId,
        removedUserEmail,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log organization switch
   */
  async logOrganizationSwitch(
    userId: string,
    fromOrganizationId: string | null,
    toOrganizationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId: toOrganizationId,
      action: "organization.switch",
      resource: "organization",
      changes: {
        fromOrganizationId: fromOrganizationId || undefined,
        toOrganizationId,
      },
      metadata,
      status: "success",
    });
  }

  async logOrganizationCreated(
    userId: string,
    organizationId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "organization.create",
      resource: "organization",
      changes: {
        created: true,
      },
      metadata,
      status: "success",
    });
  }

  /** Log product upsert (create or update — pass `created` in metadata to disambiguate). */
  async logProductUpsert(
    userId: string | undefined,
    organizationId: string,
    productId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: metadata?.created ? "product.create" : "product.update",
      resource: "product",
      changes: { productId, ...data },
      metadata,
      status: "success",
    });
  }

  /** Log product deletion. */
  async logProductDelete(
    userId: string | undefined,
    organizationId: string,
    productId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "product.delete",
      resource: "product",
      changes: { productId },
      metadata,
      status: "success",
    });
  }

  /** Log a catalogue reconciliation that removed products deleted upstream. */
  async logProductPrune(
    userId: string | undefined,
    organizationId: string,
    source: string,
    changes: { removed: number; externalIds: string[] },
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "product.prune",
      resource: "product",
      changes: { source, ...changes },
      status: "success",
    });
  }

  /** Log a bulk sync run (initial bulk import or scheduled re-sync). */
  async logProductSync(
    userId: string | undefined,
    organizationId: string,
    source: string,
    counts: { upserted: number; errors: number },
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "product.sync",
      resource: "product",
      changes: { source, ...counts },
      metadata,
      status: "success",
    });
  }

  /**
   * Log permission denied
   */
  async logPermissionDenied(
    userId: string,
    organizationId: string,
    resource: string,
    action: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "permission.denied",
      resource,
      changes: {
        attemptedAction: action,
      },
      metadata,
      status: "warning",
    });
  }
}

// Export singleton instance
export const auditLogService = new AuditLogService();
