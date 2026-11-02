import { AppDataSource } from "../database/data-source";
import { AuditLog, type AuditAction } from "../entities/audit-log.entity";
import { User } from "../entities/user.entity";
import { createLogger } from "@server/lib/logger";
import { config } from "@server/config/env";
import { createHmac } from "crypto";

const logger = createLogger("audit-log");

export interface AuditLogOptions {
  /**
   * User performing the action. Optional for system-driven events
   * (e.g. scheduled syncs, plugin workers) — the audit log row stores
   * a nullable user reference.
   */
  userId?: string;
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
export const AUDIT_LOG_RETENTION_DAYS = 90;

/** Keyed hash so failed logins for the same unknown email can be correlated without storing it. */
export function hashEmailForAudit(email: string): string {
  return createHmac("sha256", config.jwt.secret || "")
    .update(`hay:audit-email:v1:${email.trim().toLowerCase()}`)
    .digest("hex");
}

export class AuditLogService {
  private auditLogRepository = AppDataSource.getRepository(AuditLog);

  /**
   * Create a new audit log entry
   */
  async log(options: AuditLogOptions): Promise<AuditLog> {
    try {
      const auditLog = AuditLog.createLog({
        ...options,
        organizationId: options.organizationId ?? undefined,
        status: options.status || "success",
      });

      return await this.auditLogRepository.save(auditLog);
    } catch (error) {
      logger.error({ err: error }, "Failed to create audit log");
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
        select: ["id"],
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
  async cleanup(retentionDays: number = AUDIT_LOG_RETENTION_DAYS): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    return AppDataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('hay.audit_logs_purge', 'on', true)`);
      const result = await manager
        .createQueryBuilder()
        .delete()
        .from(AuditLog)
        .where("created_at < :cutoffDate", { cutoffDate })
        .execute();
      return result.affected || 0;
    });
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

  /**
   * Log agent creation
   */
  async logAgentCreate(
    userId: string,
    organizationId: string,
    agentId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "agent.create",
      resource: "agent",
      changes: {
        agentId,
        ...data,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log agent update
   */
  async logAgentUpdate(
    userId: string,
    organizationId: string,
    agentId: string,
    changes: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "agent.update",
      resource: "agent",
      changes: {
        agentId,
        ...changes,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log agent deletion
   */
  async logAgentDelete(
    userId: string,
    organizationId: string,
    agentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "agent.delete",
      resource: "agent",
      changes: {
        agentId,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log playbook creation
   */
  async logPlaybookCreate(
    userId: string,
    organizationId: string,
    playbookId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "playbook.create",
      resource: "playbook",
      changes: {
        playbookId,
        ...data,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log playbook update
   */
  async logPlaybookUpdate(
    userId: string,
    organizationId: string,
    playbookId: string,
    changes: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "playbook.update",
      resource: "playbook",
      changes: {
        playbookId,
        ...changes,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log playbook deletion
   */
  async logPlaybookDelete(
    userId: string,
    organizationId: string,
    playbookId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "playbook.delete",
      resource: "playbook",
      changes: {
        playbookId,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log playbook publish
   */
  async logPlaybookPublish(
    userId: string,
    organizationId: string,
    playbookId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "playbook.publish",
      resource: "playbook",
      changes: {
        playbookId,
        status: "published",
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log document creation
   */
  async logDocumentCreate(
    userId: string,
    organizationId: string,
    documentId: string,
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "document.create",
      resource: "document",
      changes: {
        documentId,
        ...data,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log document update
   */
  async logDocumentUpdate(
    userId: string,
    organizationId: string,
    documentId: string,
    changes: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "document.update",
      resource: "document",
      changes: {
        documentId,
        ...changes,
      },
      metadata,
      status: "success",
    });
  }

  /**
   * Log document deletion
   */
  async logDocumentDelete(
    userId: string,
    organizationId: string,
    documentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    return this.log({
      userId,
      organizationId,
      action: "document.delete",
      resource: "document",
      changes: {
        documentId,
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
