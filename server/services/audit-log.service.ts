import { AppDataSource } from "../database/data-source";
import { AuditLog, type AuditAction } from "../entities/audit-log.entity";
import { User } from "../entities/user.entity";

export interface AuditLogOptions {
  userId: string;
  organizationId?: string;
  action: AuditAction;
  resource?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
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

export class AuditLogService {
  private auditLogRepository = AppDataSource.getRepository(AuditLog);

  /**
   * Create a new audit log entry
   */
  async log(options: AuditLogOptions): Promise<AuditLog> {
    try {
      const auditLog = AuditLog.createLog({
        ...options,
        status: options.status || "success",
      });

      return await this.auditLogRepository.save(auditLog);
    } catch (error) {
      console.error("Failed to create audit log:", error);
      throw error;
    }
  }

  /**
   * Log profile update
   */
  async logProfileUpdate(
    userId: string,
    changes: Record<string, any>,
    metadata?: Record<string, any>
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
    metadata?: Record<string, any>
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
  async logPasswordChange(
    userId: string,
    metadata?: Record<string, any>
  ): Promise<AuditLog> {
    return this.log({
      userId,
      action: "password.change",
      resource: "user",
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
    metadata?: Record<string, any>
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
   * Log failed login attempt
   */
  async logFailedLogin(
    email: string,
    ipAddress?: string,
    userAgent?: string,
    errorMessage?: string
  ): Promise<AuditLog | null> {
    try {
      // Try to find user by email
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        // Can't log without a user ID - could create a separate failed_login_attempts table
        console.warn("Cannot log failed login for non-existent user:", email);
        return null;
      }

      return this.log({
        userId: user.id,
        action: "user.login",
        resource: "auth",
        ipAddress,
        userAgent,
        status: "failure",
        errorMessage: errorMessage || "Invalid credentials",
      });
    } catch (error) {
      console.error("Failed to log failed login attempt:", error);
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
      .orderBy("audit_log.createdAt", "DESC");

    if (options.userId) {
      queryBuilder.andWhere("audit_log.user_id = :userId", {
        userId: options.userId,
      });
    }

    if (options.organizationId) {
      queryBuilder.andWhere("audit_log.organization_id = :organizationId", {
        organizationId: options.organizationId,
      });
    }

    if (options.action) {
      queryBuilder.andWhere("audit_log.action = :action", {
        action: options.action,
      });
    }

    if (options.startDate) {
      queryBuilder.andWhere("audit_log.created_at >= :startDate", {
        startDate: options.startDate,
      });
    }

    if (options.endDate) {
      queryBuilder.andWhere("audit_log.created_at <= :endDate", {
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
  async getRecentSecurityEvents(
    userId: string,
    limit: number = 10
  ): Promise<AuditLog[]> {
    const { logs } = await this.getLogs({
      userId,
      limit,
    });

    return logs.filter((log) =>
      ["email.change", "password.change", "user.login", "apikey.create", "apikey.revoke"].includes(
        log.action
      )
    );
  }

  /**
   * Clean up old audit logs (retention policy)
   */
  async cleanup(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .where("created_at < :cutoffDate", { cutoffDate })
      .execute();

    return result.affected || 0;
  }
}

// Export singleton instance
export const auditLogService = new AuditLogService();
