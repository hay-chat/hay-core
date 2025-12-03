import { AppDataSource } from "@server/database/data-source";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import type { PrivacyRequestType, PrivacyRequestIdentifierType } from "@server/entities/privacy-request.entity";
import { User } from "@server/entities/user.entity";
import { AuditLog } from "@server/entities/audit-log.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { Document } from "@server/entities/document.entity";
import { Job, JobStatus, JobPriority } from "@server/entities/job.entity";
import { Customer } from "@server/database/entities/customer.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import { hashPassword, verifyPassword } from "@server/lib/auth/utils/hashing";
import { emailService } from "./email.service";
import { auditLogService } from "./audit-log.service";
import { jobQueueService } from "./job-queue.service";
import { vectorStoreService } from "./vector-store.service";
import { debugLog } from "@server/lib/debug-logger";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as archiver from "archiver";
import { getDashboardUrl } from "@server/config/env";
import { IsNull, Not, In } from "typeorm";

/**
 * Privacy Service
 * Handles GDPR Data Subject Access Requests (DSAR)
 */
export class PrivacyService {
  private readonly VERIFICATION_EXPIRY_HOURS = 24;
  private readonly EXPORT_EXPIRY_HOURS = 168; // 7 days
  private readonly DOWNLOAD_TOKEN_EXPIRY_HOURS = 4;

  /**
   * Request a data export
   */
  async requestExport(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    email = email.toLowerCase();

    // Check rate limits (defense in depth - also checked at router level)
    if (ipAddress) {
      const { rateLimitService } = await import("./rate-limit.service");
      const ipLimit = await rateLimitService.checkIpRateLimit(ipAddress, 10, 3600);
      if (ipLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      const emailLimit = await rateLimitService.checkEmailRateLimit(email, 3, 86400);
      if (emailLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      const combinedLimit = await rateLimitService.checkCombinedRateLimit(ipAddress, email, 2, 86400);
      if (combinedLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
    }

    const userRepository = AppDataSource.getRepository(User);
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find user by email
    const user = await userRepository.findOne({
      where: { email, deletedAt: IsNull() },
    });

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(verificationToken, "argon2");

    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Get max downloads from config
    const { config } = await import("@server/config/env");

    // Create privacy request
    const request = requestRepository.create({
      email,
      userId: user?.id,
      type: "export",
      status: "pending_verification",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
      ipAddress,
      userAgent,
      maxDownloads: config.privacy.maxDownloadCount,
    });

    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("privacy.export.request", email, user?.id, {
      requestId: request.id,
      ipAddress,
      userAgent,
    });

    // Send verification email with error handling
    try {
      await this.sendVerificationEmail(email, verificationToken, "export", user?.firstName);
    } catch (error) {
      // Mark request as failed if email cannot be sent
      console.error("[Privacy] Failed to send verification email:", error);
      request.status = "failed";
      request.errorMessage = "Failed to send verification email. Please try again.";
      await requestRepository.save(request);

      throw new Error("Failed to send verification email. Please try again later.");
    }

    debugLog("privacy", `Export request created for ${email}`, {
      requestId: request.id,
      hasUser: !!user,
    });

    return {
      requestId: request.id,
      expiresAt,
    };
  }

  /**
   * Confirm data export with verification token
   */
  async confirmExport(token: string): Promise<{ requestId: string; jobId: string }> {
    // Use transaction to prevent race conditions
    return AppDataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PrivacyRequest);

      // Find matching request
      const requests = await requestRepository.find({
        where: {
          type: "export",
          status: "pending_verification",
          verificationTokenHash: Not(IsNull()),
        },
      });

      let request: PrivacyRequest | null = null;
      for (const req of requests) {
        if (req.verificationTokenHash) {
          const isValid = await verifyPassword(token, req.verificationTokenHash);
          if (isValid) {
            request = req;
            break;
          }
        }
      }

      if (!request) {
        throw new Error("Invalid or expired verification token");
      }

      if (request.isExpired()) {
        request.status = "expired";
        await requestRepository.save(request);
        throw new Error("Verification token has expired");
      }

      // Mark as verified and save immediately to prevent concurrent confirmations
      request.markVerified();
      await requestRepository.save(request);

      // Create background job for export
      const jobRepository = manager.getRepository(Job);
      const userRepository = manager.getRepository(User);

      const user = request.userId
        ? await userRepository.findOne({ where: { id: request.userId } })
        : null;

      const job = jobRepository.create({
        title: `Data Export for ${request.email}`,
        description: `GDPR data export request`,
        status: JobStatus.PENDING,
        priority: JobPriority.HIGH,
        organizationId: user?.organizationId,
        data: {
          requestId: request.id,
          email: request.email,
          userId: request.userId,
        },
      });

      await jobRepository.save(job);

      // Link job to request
      request.markProcessing(job.id);
      await requestRepository.save(request);

      // Log audit trail
      await this.logPrivacyAction("privacy.export.confirm", request.email, request.userId, {
        requestId: request.id,
        jobId: job.id,
      });

      // Process export asynchronously
      this.processExportJob(job.id, request.id).catch((error) => {
        console.error("[Privacy] Export job failed:", error);
      });

      debugLog("privacy", `Export confirmed for ${request.email}`, {
        requestId: request.id,
        jobId: job.id,
      });

      return {
        requestId: request.id,
        jobId: job.id,
      };
    });
  }

  /**
   * Request data deletion
   */
  async requestDeletion(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    email = email.toLowerCase();

    // Check rate limits (defense in depth - also checked at router level)
    if (ipAddress) {
      const { rateLimitService } = await import("./rate-limit.service");
      const ipLimit = await rateLimitService.checkIpRateLimit(ipAddress, 10, 3600);
      if (ipLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      const emailLimit = await rateLimitService.checkEmailRateLimit(email, 3, 86400);
      if (emailLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }

      const combinedLimit = await rateLimitService.checkCombinedRateLimit(ipAddress, email, 2, 86400);
      if (combinedLimit.limited) {
        throw new Error("Rate limit exceeded. Please try again later.");
      }
    }

    const userRepository = AppDataSource.getRepository(User);
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find user by email
    const user = await userRepository.findOne({
      where: { email, deletedAt: IsNull() },
    });

    if (!user) {
      throw new Error("No account found with this email address");
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(verificationToken, "argon2");

    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Create privacy request
    const request = requestRepository.create({
      email,
      userId: user.id,
      type: "deletion",
      status: "pending_verification",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
      ipAddress,
      userAgent,
    });

    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("privacy.deletion.request", email, user.id, {
      requestId: request.id,
      ipAddress,
      userAgent,
    });

    // Send verification email with error handling
    try {
      await this.sendVerificationEmail(email, verificationToken, "deletion", user.firstName);
    } catch (error) {
      // Mark request as failed if email cannot be sent
      console.error("[Privacy] Failed to send verification email:", error);
      request.status = "failed";
      request.errorMessage = "Failed to send verification email. Please try again.";
      await requestRepository.save(request);

      throw new Error("Failed to send verification email. Please try again later.");
    }

    debugLog("privacy", `Deletion request created for ${email}`, {
      requestId: request.id,
      userId: user.id,
    });

    return {
      requestId: request.id,
      expiresAt,
    };
  }

  /**
   * Confirm data deletion with verification token
   */
  async confirmDeletion(token: string): Promise<{ requestId: string; jobId: string }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find matching request
    const requests = await requestRepository.find({
      where: {
        type: "deletion",
        status: "pending_verification",
        verificationTokenHash: Not(IsNull()),
      },
    });

    let request: PrivacyRequest | null = null;
    for (const req of requests) {
      if (req.verificationTokenHash) {
        const isValid = await verifyPassword(token, req.verificationTokenHash);
        if (isValid) {
          request = req;
          break;
        }
      }
    }

    if (!request) {
      throw new Error("Invalid or expired verification token");
    }

    if (request.isExpired()) {
      request.status = "expired";
      await requestRepository.save(request);
      throw new Error("Verification token has expired");
    }

    if (!request.userId) {
      throw new Error("No user found for this deletion request");
    }

    // Mark as verified
    request.markVerified();

    // Create background job for deletion
    const jobRepository = AppDataSource.getRepository(Job);
    const userRepository = AppDataSource.getRepository(User);

    const user = await userRepository.findOne({ where: { id: request.userId } });

    const job = jobRepository.create({
      title: `Data Deletion for ${request.email}`,
      description: `GDPR data deletion request`,
      status: JobStatus.PENDING,
      priority: JobPriority.CRITICAL,
      organizationId: user?.organizationId,
      data: {
        requestId: request.id,
        email: request.email,
        userId: request.userId,
      },
    });

    await jobRepository.save(job);

    // Link job to request
    request.markProcessing(job.id);
    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("privacy.deletion.confirm", request.email, request.userId, {
      requestId: request.id,
      jobId: job.id,
    });

    // Process deletion asynchronously
    this.processDeletionJob(job.id, request.id).catch((error) => {
      console.error("[Privacy] Deletion job failed:", error);
    });

    debugLog("privacy", `Deletion confirmed for ${request.email}`, {
      requestId: request.id,
      jobId: job.id,
    });

    return {
      requestId: request.id,
      jobId: job.id,
    };
  }

  /**
   * Get status of a privacy request
   */
  async getStatus(requestId: string): Promise<{
    id: string;
    type: PrivacyRequestType;
    status: string;
    createdAt: Date;
    completedAt?: Date;
    jobId?: string;
    jobStatus?: string;
    downloadAvailable: boolean;
    errorMessage?: string;
  }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
      relations: ["job"],
    });

    if (!request) {
      throw new Error("Privacy request not found");
    }

    return {
      id: request.id,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      jobId: request.jobId,
      jobStatus: request.job?.status,
      downloadAvailable: request.status === "completed" && request.type === "export",
      errorMessage: request.errorMessage,
    };
  }

  /**
   * Cancel a privacy request
   * Only pending_verification or verified requests can be cancelled
   */
  async cancelRequest(requestId: string, token: string, ipAddress?: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const jobRepository = AppDataSource.getRepository(Job);

    // Find the request
    const request = await requestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new Error("Privacy request not found");
    }

    // Verify token
    if (!request.verificationTokenHash) {
      throw new Error("This request cannot be cancelled (no verification token)");
    }

    const isValid = await verifyPassword(token, request.verificationTokenHash);
    if (!isValid) {
      throw new Error("Invalid verification token");
    }

    // Check if request can be cancelled
    const cancellableStatuses = ["pending_verification", "verified", "processing"];
    if (!cancellableStatuses.includes(request.status)) {
      throw new Error(
        `Cannot cancel request with status '${request.status}'. ` +
          `Only pending, verified, or processing requests can be cancelled.`,
      );
    }

    // If there's an associated job, cancel it
    if (request.jobId) {
      const job = await jobRepository.findOne({ where: { id: request.jobId } });
      if (job && job.status !== JobStatus.COMPLETED && job.status !== JobStatus.FAILED) {
        job.status = JobStatus.CANCELLED;
        await jobRepository.save(job);
      }
    }

    // Mark request as cancelled
    request.status = "cancelled";
    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("privacy.request.cancelled", request.email, request.userId, {
      requestId: request.id,
      type: request.type,
      ipAddress,
    });

    debugLog("privacy", `Privacy request cancelled: ${requestId}`, {
      type: request.type,
      email: request.email,
    });
  }

  /**
   * Download export data
   * Supports both legacy JSON and new ZIP format
   */
  async downloadExport(
    requestId: string,
    downloadToken: string,
    ipAddress?: string,
  ): Promise<{ data: any; fileName: string; isZip?: boolean; filePath?: string }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId, type: "export", status: "completed" },
    });

    if (!request) {
      throw new Error("Export request not found or not ready");
    }

    // Verify download token
    const storedToken = request.getDownloadToken();
    if (!storedToken || storedToken !== downloadToken) {
      throw new Error("Invalid download token");
    }

    // Check if export has expired
    const exportExpiresAt = request.metadata?.exportExpiresAt as string | undefined;
    if (exportExpiresAt && new Date(exportExpiresAt) < new Date()) {
      throw new Error("Export has expired");
    }

    // Check if already downloaded (single-use)
    // Note: maxDownloads is set at request creation time and doesn't change
    // if PRIVACY_MAX_DOWNLOAD_COUNT env var is updated later. This is intentional
    // for security - we don't want to retroactively increase limits on existing requests.
    if (request.downloadCount >= request.maxDownloads) {
      throw new Error(
        "Download limit exceeded. This link has already been used. " +
          "Please request a new export if needed.",
      );
    }

    // Check IP restriction (optional - can be disabled for mobile users)
    const { config } = await import("@server/config/env");
    const ENABLE_IP_RESTRICTION = config.privacy.downloadIpRestriction;

    if (
      ENABLE_IP_RESTRICTION &&
      ipAddress &&
      request.downloadIpAddress &&
      request.downloadIpAddress !== ipAddress
    ) {
      console.warn(`[Privacy] Download attempt from different IP`, {
        requestId,
        originalIp: request.downloadIpAddress,
        currentIp: ipAddress,
      });

      // Log security event
      await this.logPrivacyAction("privacy.download.ip_mismatch", request.email, request.userId, {
        requestId,
        originalIp: request.downloadIpAddress,
        attemptedIp: ipAddress,
      });

      throw new Error(
        "Security validation failed. Please download from the same device/network " +
          "used to request the export.",
      );
    }

    // Read export file
    const exportUrl = request.getExportUrl();
    if (!exportUrl) {
      throw new Error("Export file not found");
    }

    // Record download
    if (!request.downloadedAt) {
      request.downloadIpAddress = ipAddress;
      request.downloadedAt = new Date();
    }
    request.downloadCount += 1;
    await requestRepository.save(request);

    // Log download
    await this.logPrivacyAction("privacy.export.download", request.email, request.userId, {
      requestId: request.id,
      downloadCount: request.downloadCount,
      ipAddress,
    });

    debugLog("privacy", `Export downloaded for ${request.email}`, {
      requestId: request.id,
      downloadCount: request.downloadCount,
    });

    // Check if it's a ZIP file (new format) or JSON (legacy)
    const isZip = exportUrl.endsWith(".zip") || request.metadata?.exportFormat === "zip";
    const dateStr = new Date().toISOString().split("T")[0];

    if (isZip) {
      // Return ZIP file path for streaming
      return {
        data: null,
        fileName: `data-export-${request.email}-${dateStr}.zip`,
        isZip: true,
        filePath: exportUrl,
      };
    }

    // Legacy JSON format
    const exportData = await fs.readFile(exportUrl, "utf-8");
    const data = JSON.parse(exportData);

    return {
      data,
      fileName: `data-export-${request.email}-${dateStr}.json`,
      isZip: false,
    };
  }

  /**
   * Collect all user data for export
   */
  private async collectUserData(userId: string, email: string): Promise<any> {
    const userRepository = AppDataSource.getRepository(User);
    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const auditLogRepository = AppDataSource.getRepository(AuditLog);
    const documentRepository = AppDataSource.getRepository(Document);

    // Get user profile
    const user = await userRepository.findOne({
      where: { id: userId },
      relations: ["organization"],
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Note: API keys are now organization-scoped, not user-scoped
    // They are not included in individual user data exports
    const apiKeys: any[] = [];

    // Get audit logs
    const auditLogs = await auditLogRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 1000, // Limit to last 1000 events
    });

    // Get documents
    const documents = await documentRepository.find({
      where: [{ createdBy: userId }, { updatedBy: userId }],
      select: ["id", "title", "createdAt", "updatedAt", "metadata"],
    });

    return {
      exportDate: new Date().toISOString(),
      dataSubject: {
        email: user.email,
        userId: user.id,
      },
      personalData: {
        profile: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          lastSeenAt: user.lastSeenAt,
          role: user.role,
          status: user.status,
        },
        organization: user.organization
          ? {
              id: user.organization.id,
              name: user.organization.name,
              role: user.role,
            }
          : null,
        apiKeys: apiKeys.map((key) => ({
          id: key.id,
          name: key.name,
          createdAt: key.createdAt,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          scopes: key.scopes,
          isActive: key.isActive,
        })),
        auditLogs: auditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          changes: log.changes,
          createdAt: log.createdAt,
          ipAddress: log.ipAddress,
          status: log.status,
        })),
        documents: documents.map((doc) => ({
          id: doc.id,
          title: doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          metadata: doc.metadata,
        })),
      },
    };
  }

  /**
   * Process export job in background
   */
  private async processExportJob(jobId: string, requestId: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    try {
      // Update job status
      await jobQueueService.updateJobStatus(jobId, "", {
        status: JobStatus.PROCESSING,
      });

      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (!request || !request.userId) {
        throw new Error("Invalid request or no user associated");
      }

      // Collect user data
      const exportData = await this.collectUserData(request.userId, request.email);

      // Create signed ZIP export
      const { filePath, signature } = await this.createSignedZipExport(
        exportData,
        requestId,
        request.email,
      );

      // Generate download token
      const downloadToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + this.EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

      // Update request with export metadata
      request.setExportMetadata(filePath, downloadToken, expiresAt);
      request.metadata = {
        ...request.metadata,
        signature,
        exportFormat: "zip",
      };
      request.markCompleted();
      await requestRepository.save(request);

      // Complete job
      await jobQueueService.completeJob(jobId, "", {
        exportUrl: filePath,
        downloadToken,
        expiresAt: expiresAt.toISOString(),
      });

      // Send notification email
      await this.sendExportReadyEmail(request.email, requestId, downloadToken);

      debugLog("privacy", `Export completed for ${request.email}`, {
        requestId,
        jobId,
        filePath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[Privacy] Export job failed:", error);

      // Update request
      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (request) {
        request.setError(errorMessage);
        await requestRepository.save(request);
      }

      // Fail job
      await jobQueueService.failJob(jobId, "", errorMessage);
    }
  }

  /**
   * Process deletion job in background
   */
  private async processDeletionJob(jobId: string, requestId: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    try {
      // Update job status
      await jobQueueService.updateJobStatus(jobId, "", {
        status: JobStatus.PROCESSING,
      });

      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (!request || !request.userId) {
        throw new Error("Invalid request or no user associated");
      }

      // Execute deletion
      await this.executeDataDeletion(request.userId, request.email);

      // Update request
      request.markCompleted();
      await requestRepository.save(request);

      // Complete job
      await jobQueueService.completeJob(jobId, "", {
        deletedAt: new Date().toISOString(),
        userId: request.userId,
      });

      // Log completion
      await this.logPrivacyAction("privacy.deletion.complete", request.email, request.userId, {
        requestId,
        jobId,
      });

      // Send confirmation email
      await this.sendDeletionCompleteEmail(request.email);

      debugLog("privacy", `Deletion completed for ${request.email}`, {
        requestId,
        jobId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[Privacy] Deletion job failed:", error);

      // Update request
      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (request) {
        request.setError(errorMessage);
        await requestRepository.save(request);
      }

      // Fail job
      await jobQueueService.failJob(jobId, "", errorMessage);
    }
  }

  /**
   * Execute data deletion (soft delete user, hard delete sensitive data)
   */
  private async executeDataDeletion(userId: string, email: string): Promise<void> {
    return AppDataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const apiKeyRepository = manager.getRepository(ApiKey);
      const auditLogRepository = manager.getRepository(AuditLog);

      // Get user
      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }

      // Note: API keys are now organization-scoped, not user-scoped
      // They are managed at the organization level and not deleted with individual users

      // Anonymize audit logs (keep for compliance but remove PII)
      const auditLogs = await auditLogRepository.find({ where: { userId } });

      for (const log of auditLogs) {
        // Anonymize user identifier - set to null since userId is UUID type
        log.userId = null as any;

        // Anonymize IP addresses
        if (log.ipAddress) {
          log.ipAddress = this.anonymizeIpAddress(log.ipAddress);
        }

        // Anonymize user agent
        if (log.userAgent) {
          log.userAgent = "deleted";
        }

        // Anonymize PII in changes/metadata JSON fields
        if (log.changes) {
          log.changes = this.anonymizeJsonPii(log.changes);
        }

        if (log.metadata) {
          log.metadata = this.anonymizeJsonPii(log.metadata);
        }

        await auditLogRepository.save(log);
      }

      // Soft delete user
      user.softDelete();
      user.email = `deleted-${userId}@deleted.local`;
      user.firstName = null as any;
      user.lastName = null as any;
      user.password = "deleted";

      await userRepository.save(user);

      debugLog("privacy", `User data deleted for ${email}`, { userId });
    });
  }

  /**
   * Send verification email
   */
  private async sendVerificationEmail(
    email: string,
    token: string,
    type: "export" | "deletion",
    firstName?: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const verificationUrl = `${baseUrl}/privacy/verify?token=${token}&type=${type}`;

    const template = type === "export" ? "privacy-export-request" : "privacy-deletion-request";
    const subject = type === "export" ? "Verify Your Data Export Request" : "Verify Your Data Deletion Request";

    await emailService.sendTemplateEmail({
      to: email,
      subject,
      template,
      variables: {
        userName: firstName || email,
        verificationUrl,
        companyName: "Hay",
        expiresIn: `${this.VERIFICATION_EXPIRY_HOURS} hours`,
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Send export ready notification
   */
  private async sendExportReadyEmail(
    email: string,
    requestId: string,
    downloadToken: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const downloadUrl = `${baseUrl}/privacy/download?requestId=${requestId}&token=${downloadToken}`;

    await emailService.sendTemplateEmail({
      to: email,
      subject: "Your Data Export is Ready",
      template: "privacy-export-ready",
      variables: {
        downloadUrl,
        expiresIn: `${this.EXPORT_EXPIRY_HOURS / 24} days`,
        companyName: "Hay",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Send deletion complete notification
   */
  private async sendDeletionCompleteEmail(email: string): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();

    await emailService.sendTemplateEmail({
      to: email,
      subject: "Your Data Has Been Deleted",
      template: "privacy-deletion-complete",
      variables: {
        companyName: "Hay",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Log privacy action to audit log
   */
  private async logPrivacyAction(
    action: string,
    email: string,
    userId?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await auditLogService.log({
        userId: userId || "anonymous",
        action: action as any,
        resource: "privacy_request",
        changes: { email, ...metadata },
        status: "success",
        ipAddress: metadata?.ipAddress,
        userAgent: metadata?.userAgent,
      });
    } catch (error) {
      console.error("[Privacy] Failed to log audit action:", error);
    }
  }

  /**
   * ========================================================================
   * CUSTOMER PRIVACY METHODS (B2B2C)
   * ========================================================================
   */

  /**
   * Request a customer data export
   */
  async requestCustomerExport(
    organizationId: string,
    identifier: { type: PrivacyRequestIdentifierType; value: string },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date; customerFound: boolean }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find customer by identifier
    const customer = await this.findCustomer(organizationId, identifier);

    if (!customer) {
      debugLog("privacy", `Customer not found for export request`, {
        organizationId,
        identifierType: identifier.type,
        identifierValue: identifier.value,
      });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(verificationToken, "argon2");

    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Determine email for verification
    const verificationEmail = this.getVerificationEmail(customer, identifier);

    if (!verificationEmail) {
      throw new Error("Cannot send verification email: no email address available");
    }

    // Create privacy request
    // Get max downloads from config
    const { config: envConfig } = await import("@server/config/env");

    const request = requestRepository.create({
      email: verificationEmail,
      customerId: customer?.id,
      organizationId,
      type: "export",
      subjectType: "customer",
      status: "pending_verification",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
      identifierType: identifier.type,
      identifierValue: identifier.value,
      ipAddress,
      userAgent,
      maxDownloads: envConfig.privacy.maxDownloadCount,
    });

    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("customer.privacy.export.request", verificationEmail, undefined, {
      requestId: request.id,
      organizationId,
      customerId: customer?.id,
      identifierType: identifier.type,
      ipAddress,
      userAgent,
    });

    // Send verification email
    await this.sendCustomerVerificationEmail(
      verificationEmail,
      verificationToken,
      "export",
      organizationId,
      customer?.name,
    );

    debugLog("privacy", `Customer export request created`, {
      requestId: request.id,
      organizationId,
      hasCustomer: !!customer,
      identifierType: identifier.type,
    });

    return {
      requestId: request.id,
      expiresAt,
      customerFound: !!customer,
    };
  }

  /**
   * Confirm customer data export with verification token
   */
  async confirmCustomerExport(token: string): Promise<{ requestId: string; jobId: string }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find matching request
    const requests = await requestRepository.find({
      where: {
        type: "export",
        subjectType: "customer",
        status: "pending_verification",
        verificationTokenHash: Not(IsNull()),
      },
    });

    let request: PrivacyRequest | null = null;
    for (const req of requests) {
      if (req.verificationTokenHash) {
        const isValid = await verifyPassword(token, req.verificationTokenHash);
        if (isValid) {
          request = req;
          break;
        }
      }
    }

    if (!request) {
      throw new Error("Invalid or expired verification token");
    }

    if (request.isExpired()) {
      request.status = "expired";
      await requestRepository.save(request);
      throw new Error("Verification token has expired");
    }

    if (!request.customerId) {
      throw new Error("No customer found for this export request");
    }

    // Mark as verified
    request.markVerified();

    // Create background job for export
    const jobRepository = AppDataSource.getRepository(Job);

    const job = jobRepository.create({
      title: `Customer Data Export for ${request.email}`,
      description: `GDPR customer data export request`,
      status: JobStatus.PENDING,
      priority: JobPriority.HIGH,
      organizationId: request.organizationId,
      data: {
        requestId: request.id,
        email: request.email,
        customerId: request.customerId,
        organizationId: request.organizationId,
      },
    });

    await jobRepository.save(job);

    // Link job to request
    request.markProcessing(job.id);
    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("customer.privacy.export.confirm", request.email, undefined, {
      requestId: request.id,
      jobId: job.id,
      organizationId: request.organizationId,
      customerId: request.customerId,
    });

    // Process export asynchronously
    this.processCustomerExportJob(job.id, request.id).catch((error) => {
      console.error("[Privacy] Customer export job failed:", error);
    });

    debugLog("privacy", `Customer export confirmed`, {
      requestId: request.id,
      jobId: job.id,
      organizationId: request.organizationId,
    });

    return {
      requestId: request.id,
      jobId: job.id,
    };
  }

  /**
   * Request customer data deletion
   */
  async requestCustomerDeletion(
    organizationId: string,
    identifier: { type: PrivacyRequestIdentifierType; value: string },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find customer by identifier
    const customer = await this.findCustomer(organizationId, identifier);

    if (!customer) {
      throw new Error("No customer found with this identifier");
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = await hashPassword(verificationToken, "argon2");

    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Determine email for verification
    const verificationEmail = this.getVerificationEmail(customer, identifier);

    if (!verificationEmail) {
      throw new Error("Cannot send verification email: no email address available");
    }

    // Create privacy request
    const request = requestRepository.create({
      email: verificationEmail,
      customerId: customer.id,
      organizationId,
      type: "deletion",
      subjectType: "customer",
      status: "pending_verification",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
      identifierType: identifier.type,
      identifierValue: identifier.value,
      ipAddress,
      userAgent,
    });

    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("customer.privacy.deletion.request", verificationEmail, undefined, {
      requestId: request.id,
      organizationId,
      customerId: customer.id,
      identifierType: identifier.type,
      ipAddress,
      userAgent,
    });

    // Send verification email
    await this.sendCustomerVerificationEmail(
      verificationEmail,
      verificationToken,
      "deletion",
      organizationId,
      customer.name,
    );

    debugLog("privacy", `Customer deletion request created`, {
      requestId: request.id,
      organizationId,
      customerId: customer.id,
    });

    return {
      requestId: request.id,
      expiresAt,
    };
  }

  /**
   * Confirm customer data deletion with verification token
   */
  async confirmCustomerDeletion(token: string): Promise<{ requestId: string; jobId: string }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    // Find matching request
    const requests = await requestRepository.find({
      where: {
        type: "deletion",
        subjectType: "customer",
        status: "pending_verification",
        verificationTokenHash: Not(IsNull()),
      },
    });

    let request: PrivacyRequest | null = null;
    for (const req of requests) {
      if (req.verificationTokenHash) {
        const isValid = await verifyPassword(token, req.verificationTokenHash);
        if (isValid) {
          request = req;
          break;
        }
      }
    }

    if (!request) {
      throw new Error("Invalid or expired verification token");
    }

    if (request.isExpired()) {
      request.status = "expired";
      await requestRepository.save(request);
      throw new Error("Verification token has expired");
    }

    if (!request.customerId) {
      throw new Error("No customer found for this deletion request");
    }

    // Mark as verified
    request.markVerified();

    // Create background job for deletion
    const jobRepository = AppDataSource.getRepository(Job);

    const job = jobRepository.create({
      title: `Customer Data Deletion for ${request.email}`,
      description: `GDPR customer data deletion request`,
      status: JobStatus.PENDING,
      priority: JobPriority.CRITICAL,
      organizationId: request.organizationId,
      data: {
        requestId: request.id,
        email: request.email,
        customerId: request.customerId,
        organizationId: request.organizationId,
      },
    });

    await jobRepository.save(job);

    // Link job to request
    request.markProcessing(job.id);
    await requestRepository.save(request);

    // Log audit trail
    await this.logPrivacyAction("customer.privacy.deletion.confirm", request.email, undefined, {
      requestId: request.id,
      jobId: job.id,
      organizationId: request.organizationId,
      customerId: request.customerId,
    });

    // Process deletion asynchronously
    this.processCustomerDeletionJob(job.id, request.id).catch((error) => {
      console.error("[Privacy] Customer deletion job failed:", error);
    });

    debugLog("privacy", `Customer deletion confirmed`, {
      requestId: request.id,
      jobId: job.id,
      organizationId: request.organizationId,
    });

    return {
      requestId: request.id,
      jobId: job.id,
    };
  }

  /**
   * Find customer by identifier
   */
  private async findCustomer(
    organizationId: string,
    identifier: { type: PrivacyRequestIdentifierType; value: string },
  ): Promise<Customer | null> {
    const customerRepository = AppDataSource.getRepository(Customer);

    let customer: Customer | null = null;

    switch (identifier.type) {
      case "email":
        customer = await customerRepository.findOne({
          where: { email: identifier.value, organization_id: organizationId },
        });
        break;

      case "phone":
        customer = await customerRepository.findOne({
          where: { phone: identifier.value, organization_id: organizationId },
        });
        break;

      case "externalId":
        customer = await customerRepository.findOne({
          where: { external_id: identifier.value, organization_id: organizationId },
        });
        break;
    }

    return customer;
  }

  /**
   * Get verification email from customer or identifier
   */
  private getVerificationEmail(
    customer: Customer | null,
    identifier: { type: PrivacyRequestIdentifierType; value: string },
  ): string | null {
    // If customer has email, use it
    if (customer?.email) {
      return customer.email;
    }

    // If identifier is email, use that
    if (identifier.type === "email") {
      return identifier.value;
    }

    // No email available
    return null;
  }

  /**
   * Collect all customer data for export
   * GDPR Article 15 - Right of Access
   * Traverses: customers → conversations → messages → embeddings
   */
  private async collectCustomerData(customerId: string, organizationId: string): Promise<any> {
    const customerRepository = AppDataSource.getRepository(Customer);
    const conversationRepository = AppDataSource.getRepository(Conversation);
    const messageRepository = AppDataSource.getRepository(Message);

    // Get customer profile
    const customer = await customerRepository.findOne({
      where: { id: customerId, organization_id: organizationId },
    });

    if (!customer) {
      throw new Error("Customer not found");
    }

    // Get all conversations for this customer
    const conversations = await conversationRepository.find({
      where: { customer_id: customerId, organization_id: organizationId },
      order: { created_at: "ASC" },
    });

    const conversationIds = conversations.map((c) => c.id);
    const allMessageIds: string[] = [];

    // Get all messages for each conversation
    const conversationsWithMessages = await Promise.all(
      conversations.map(async (conversation) => {
        const messages = await messageRepository.find({
          where: { conversation_id: conversation.id },
          order: { created_at: "ASC" },
        });

        // Collect message IDs for embedding lookup
        allMessageIds.push(...messages.map((m) => m.id));

        return {
          id: conversation.id,
          title: conversation.title,
          channel: conversation.channel,
          status: conversation.status,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
          closedAt: conversation.closed_at,
          lastMessageAt: conversation.lastMessageAt,
          metadata: conversation.metadata,
          messages: messages.map((msg) => ({
            id: msg.id,
            content: msg.content,
            type: msg.type,
            direction: msg.direction,
            sender: msg.sender,
            createdAt: msg.created_at,
            metadata: msg.metadata,
            sentiment: msg.sentiment,
            intent: msg.intent,
            attachments: msg.attachments || [],
          })),
        };
      }),
    );

    // Collect embeddings associated with conversations and messages
    // These contain vectorized representations of customer message content
    let embeddings: Array<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
      createdAt?: Date;
      source: "conversation" | "message";
    }> = [];

    try {
      // Get embeddings by conversation IDs
      if (conversationIds.length > 0) {
        const conversationEmbeddings = await vectorStoreService.findByConversationIds(
          organizationId,
          conversationIds,
        );
        embeddings.push(
          ...conversationEmbeddings.map((e) => ({
            id: e.id,
            content: e.pageContent,
            metadata: e.metadata || {},
            createdAt: e.createdAt,
            source: "conversation" as const,
          })),
        );
      }

      // Get embeddings by message IDs
      if (allMessageIds.length > 0) {
        const messageEmbeddings = await vectorStoreService.findByMessageIds(
          organizationId,
          allMessageIds,
        );
        // Filter out duplicates (some embeddings might be found by both conversation and message)
        const existingIds = new Set(embeddings.map((e) => e.id));
        embeddings.push(
          ...messageEmbeddings
            .filter((e) => !existingIds.has(e.id))
            .map((e) => ({
              id: e.id,
              content: e.pageContent,
              metadata: e.metadata || {},
              createdAt: e.createdAt,
              source: "message" as const,
            })),
        );
      }
    } catch (error) {
      console.warn("[Privacy] Error collecting embeddings for export:", error);
      // Continue without embeddings - they might not exist
    }

    return {
      exportDate: new Date().toISOString(),
      exportVersion: "2.0",
      dataSubject: {
        customerId: customer.id,
        organizationId,
      },
      personalData: {
        profile: {
          externalId: customer.external_id,
          email: customer.email,
          phone: customer.phone,
          name: customer.name,
          notes: customer.notes,
          externalMetadata: customer.external_metadata,
          createdAt: customer.created_at,
          updatedAt: customer.updated_at,
        },
        conversations: conversationsWithMessages,
        embeddings: embeddings.map((e) => ({
          id: e.id,
          content: e.content,
          metadata: e.metadata,
          createdAt: e.createdAt,
          source: e.source,
        })),
        statistics: {
          totalConversations: conversations.length,
          totalMessages: conversationsWithMessages.reduce(
            (sum, conv) => sum + conv.messages.length,
            0,
          ),
          totalAttachments: conversationsWithMessages.reduce(
            (sum, conv) =>
              sum + conv.messages.reduce((msgSum, msg) => msgSum + (msg.attachments?.length || 0), 0),
            0,
          ),
          totalEmbeddings: embeddings.length,
        },
      },
    };
  }

  /**
   * Process customer export job in background
   * Creates a signed ZIP file with data.json, README.md, and manifest.json
   */
  private async processCustomerExportJob(jobId: string, requestId: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    try {
      // Update job status
      await jobQueueService.updateJobStatus(jobId, "", {
        status: JobStatus.PROCESSING,
      });

      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (!request || !request.customerId || !request.organizationId) {
        throw new Error("Invalid request or no customer associated");
      }

      // Collect customer data
      const exportData = await this.collectCustomerData(request.customerId, request.organizationId);

      // Create signed ZIP export
      const { filePath, signature } = await this.createSignedZipExport(
        exportData,
        requestId,
        request.email,
      );

      // Generate download token
      const downloadToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + this.EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

      // Update request with export metadata
      request.setExportMetadata(filePath, downloadToken, expiresAt);
      request.metadata = {
        ...request.metadata,
        signature,
        exportFormat: "zip",
      };
      request.markCompleted();
      await requestRepository.save(request);

      // Complete job
      await jobQueueService.completeJob(jobId, "", {
        exportUrl: filePath,
        downloadToken,
        expiresAt: expiresAt.toISOString(),
        signature,
      });

      // Send notification email
      await this.sendCustomerExportReadyEmail(
        request.email,
        requestId,
        downloadToken,
        request.organizationId!,
      );

      debugLog("privacy", `Customer export completed`, {
        requestId,
        jobId,
        customerId: request.customerId,
        organizationId: request.organizationId,
        exportFormat: "zip",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[Privacy] Customer export job failed:", error);

      // Update request
      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (request) {
        request.setError(errorMessage);
        await requestRepository.save(request);
      }

      // Fail job
      await jobQueueService.failJob(jobId, "", errorMessage);
    }
  }

  /**
   * Create a signed ZIP export file containing data.json, README.md, manifest.json, and attachments
   */
  private async createSignedZipExport(
    exportData: any,
    requestId: string,
    email: string,
  ): Promise<{ filePath: string; signature: string }> {
    const exportDir = path.join(process.cwd(), "exports");
    await fs.mkdir(exportDir, { recursive: true });

    const zipFileName = `customer-export-${requestId}.zip`;
    const zipFilePath = path.join(exportDir, zipFileName);

    // Collect all attachments from conversations/messages
    const attachments: Array<{
      messageId: string;
      conversationId: string;
      id: string;
      name: string;
      url: string;
      type: string;
      size: number;
    }> = [];

    if (exportData.personalData?.conversations) {
      for (const conv of exportData.personalData.conversations) {
        for (const msg of conv.messages || []) {
          for (const attachment of msg.attachments || []) {
            attachments.push({
              messageId: msg.id,
              conversationId: conv.id,
              ...attachment,
            });
          }
        }
      }
    }

    // Download attachments and prepare for archive
    const downloadedFiles: Array<{
      path: string;
      buffer: Buffer;
      originalUrl: string;
    }> = [];

    for (const attachment of attachments) {
      try {
        // Handle local file paths vs URLs
        if (attachment.url.startsWith("/") || attachment.url.startsWith("./")) {
          // Local file - read directly
          const localPath = path.join(process.cwd(), "uploads", attachment.url.replace(/^\.?\//, ""));
          try {
            const fileBuffer = await fs.readFile(localPath);
            downloadedFiles.push({
              path: `attachments/${attachment.conversationId}/${attachment.id}_${attachment.name}`,
              buffer: fileBuffer,
              originalUrl: attachment.url,
            });
          } catch (err) {
            console.warn(`[Privacy] Could not read local attachment: ${localPath}`, err);
          }
        } else if (attachment.url.startsWith("http")) {
          // Remote URL - download
          try {
            const response = await fetch(attachment.url);
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              downloadedFiles.push({
                path: `attachments/${attachment.conversationId}/${attachment.id}_${attachment.name}`,
                buffer: Buffer.from(arrayBuffer),
                originalUrl: attachment.url,
              });
            }
          } catch (err) {
            console.warn(`[Privacy] Could not download attachment: ${attachment.url}`, err);
          }
        }
      } catch (err) {
        console.warn(`[Privacy] Error processing attachment ${attachment.id}:`, err);
      }
    }

    // Prepare JSON data
    const dataJson = JSON.stringify(exportData, null, 2);

    // Generate manifest with attachments
    const fileList = ["data.json", "README.md", "manifest.json", "signature.txt"];
    if (downloadedFiles.length > 0) {
      fileList.push(...downloadedFiles.map((f) => f.path));
    }

    const manifest = {
      version: "2.0",
      exportId: requestId,
      exportDate: exportData.exportDate,
      dataSubject: exportData.dataSubject,
      statistics: {
        ...exportData.personalData.statistics,
        totalAttachments: attachments.length,
        downloadedAttachments: downloadedFiles.length,
      },
      format: "GDPR DSAR Export",
      files: fileList,
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        messageId: a.messageId,
        conversationId: a.conversationId,
        type: a.type,
        size: a.size,
        included: downloadedFiles.some((f) => f.originalUrl === a.url),
      })),
    };
    const manifestJson = JSON.stringify(manifest, null, 2);

    // Generate README with attachment info
    const readme = this.generateExportReadme(exportData, requestId, attachments.length, downloadedFiles.length);

    // Sign the data (HMAC-SHA256 of data.json content)
    const signature = this.signExportData(dataJson);

    // Create ZIP archive
    const { createWriteStream } = await import("fs");
    const output = createWriteStream(zipFilePath);
    const archive = archiver.default("zip", { zlib: { level: 9 } });

    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("error", reject);

      archive.pipe(output);
      archive.append(dataJson, { name: "data.json" });
      archive.append(readme, { name: "README.md" });
      archive.append(manifestJson, { name: "manifest.json" });
      archive.append(signature, { name: "signature.txt" });

      // Add downloaded attachments
      for (const file of downloadedFiles) {
        archive.append(file.buffer, { name: file.path });
      }

      archive.finalize();
    });

    return { filePath: zipFilePath, signature };
  }

  /**
   * Generate README.md for the export package
   */
  private generateExportReadme(
    exportData: any,
    requestId: string,
    totalAttachments: number = 0,
    downloadedAttachments: number = 0,
  ): string {
    const stats = exportData.personalData.statistics;
    const exportDate = new Date(exportData.exportDate).toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "long",
    });

    const attachmentSection =
      totalAttachments > 0
        ? `
### File Attachments
${totalAttachments} file attachment(s) found:
- ${downloadedAttachments} successfully included in this archive
- Located in the \`attachments/\` folder, organized by conversation ID
${totalAttachments !== downloadedAttachments ? `- ${totalAttachments - downloadedAttachments} file(s) could not be retrieved (may have been deleted or are inaccessible)` : ""}
`
        : "";

    const attachmentFilesRow =
      downloadedAttachments > 0
        ? `| attachments/ | File attachments from your conversations |
`
        : "";

    return `# GDPR Data Export

## Export Information

- **Export ID:** ${requestId}
- **Export Date:** ${exportDate}
- **Customer ID:** ${exportData.dataSubject.customerId}
- **Export Format:** ZIP Archive with JSON data

## Contents

This archive contains your personal data as required under GDPR Article 15 (Right of Access):

| File | Description |
|------|-------------|
| data.json | Your personal data in machine-readable JSON format |
| manifest.json | Export metadata and file listing |
| README.md | This documentation file |
| signature.txt | Cryptographic signature for data integrity verification |
${attachmentFilesRow}
## Data Included

### Profile Information
Your customer profile data including:
- Email address
- Phone number
- Name
- Any custom metadata

### Conversations
${stats.totalConversations} conversation(s) containing:
- ${stats.totalMessages} message(s)
- Timestamps and metadata
- Message content and direction
${attachmentSection}
### Embeddings
${stats.totalEmbeddings || 0} embedding(s):
- Vectorized representations of your message content
- Used for AI-powered search and assistance

## Data Structure

The \`data.json\` file contains:

\`\`\`json
{
  "exportDate": "ISO 8601 timestamp",
  "exportVersion": "2.0",
  "dataSubject": {
    "customerId": "UUID",
    "organizationId": "UUID"
  },
  "personalData": {
    "profile": { ... },
    "conversations": [ ... ],
    "embeddings": [ ... ],
    "statistics": { ... }
  }
}
\`\`\`

## Verifying Data Integrity

The \`signature.txt\` file contains an HMAC-SHA256 signature of the \`data.json\` file.
This allows you to verify that the data has not been tampered with.

## Your Rights Under GDPR

As a data subject, you have the following rights:

1. **Right of Access** (Article 15) - This export fulfills this right
2. **Right to Rectification** (Article 16) - Request corrections to inaccurate data
3. **Right to Erasure** (Article 17) - Request deletion of your personal data
4. **Right to Data Portability** (Article 20) - This export is in machine-readable format

## Questions?

If you have questions about your data or wish to exercise your other GDPR rights,
please contact the organization through their support channels.

---

*This export was generated automatically by the Hay Platform DSAR system.*
`;
  }

  /**
   * Sign export data using HMAC-SHA256
   * Uses a deterministic key derived from the organization's data
   */
  private signExportData(data: string): string {
    // Use a signing key from environment or generate a deterministic one
    const { config } = require("@server/config/env");
    const signingKey = config.jwt.secret || "hay-dsar-export-signing-key";

    const hmac = crypto.createHmac("sha256", signingKey);
    hmac.update(data);
    return hmac.digest("hex");
  }

  /**
   * Process customer deletion job in background
   */
  private async processCustomerDeletionJob(jobId: string, requestId: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    try {
      // Update job status
      await jobQueueService.updateJobStatus(jobId, "", {
        status: JobStatus.PROCESSING,
      });

      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (!request || !request.customerId || !request.organizationId) {
        throw new Error("Invalid request or no customer associated");
      }

      // Execute deletion
      await this.executeCustomerDeletion(request.customerId, request.organizationId);

      // Update request
      request.markCompleted();
      await requestRepository.save(request);

      // Complete job
      await jobQueueService.completeJob(jobId, "", {
        deletedAt: new Date().toISOString(),
        customerId: request.customerId,
      });

      // Log completion
      await this.logPrivacyAction(
        "customer.privacy.deletion.complete",
        request.email,
        undefined,
        {
          requestId,
          jobId,
          customerId: request.customerId,
          organizationId: request.organizationId,
        },
      );

      // Send confirmation email
      await this.sendCustomerDeletionCompleteEmail(request.email, request.organizationId);

      debugLog("privacy", `Customer deletion completed`, {
        requestId,
        jobId,
        customerId: request.customerId,
        organizationId: request.organizationId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[Privacy] Customer deletion job failed:", error);

      // Update request
      const request = await requestRepository.findOne({ where: { id: requestId } });
      if (request) {
        request.setError(errorMessage);
        await requestRepository.save(request);
      }

      // Fail job
      await jobQueueService.failJob(jobId, "", errorMessage);
    }
  }

  /**
   * Execute customer data deletion
   * Soft delete customer, anonymize conversations and messages, delete embeddings
   * GDPR Article 17 - Right to Erasure
   */
  private async executeCustomerDeletion(customerId: string, organizationId: string): Promise<void> {
    return AppDataSource.transaction(async (manager) => {
      const customerRepository = manager.getRepository(Customer);
      const conversationRepository = manager.getRepository(Conversation);
      const messageRepository = manager.getRepository(Message);

      // Get customer
      const customer = await customerRepository.findOne({
        where: { id: customerId, organization_id: organizationId },
      });

      if (!customer) {
        throw new Error("Customer not found");
      }

      // Get all conversations
      const conversations = await conversationRepository.find({
        where: { customer_id: customerId, organization_id: organizationId },
      });

      const conversationIds = conversations.map((c) => c.id);

      // Get all message IDs for embedding deletion
      const allMessageIds: string[] = [];
      for (const conversation of conversations) {
        const messages = await messageRepository.find({
          where: { conversation_id: conversation.id },
          select: ["id"],
        });
        allMessageIds.push(...messages.map((m) => m.id));
      }

      // Delete embeddings associated with conversations and messages
      // This ensures no orphaned vectors remain (GDPR compliance)
      let embeddingsDeleted = 0;
      try {
        if (conversationIds.length > 0) {
          const deletedByConversation = await vectorStoreService.deleteByConversationIds(
            organizationId,
            conversationIds,
          );
          embeddingsDeleted += deletedByConversation;
        }

        if (allMessageIds.length > 0) {
          const deletedByMessage = await vectorStoreService.deleteByMessageIds(
            organizationId,
            allMessageIds,
          );
          embeddingsDeleted += deletedByMessage;
        }

        debugLog("privacy", `Deleted ${embeddingsDeleted} embeddings for customer`, {
          customerId,
          organizationId,
          conversationIds: conversationIds.length,
          messageIds: allMessageIds.length,
        });
      } catch (error) {
        // Log but don't fail the transaction - embeddings might not exist
        console.warn("[Privacy] Error deleting embeddings:", error);
      }

      // Anonymize messages in all conversations
      for (const conversation of conversations) {
        await messageRepository.update(
          { conversation_id: conversation.id },
          {
            content: "[deleted]",
            sender: "[deleted]",
            metadata: null,
          },
        );
      }

      // Update conversations to remove customer reference and anonymize
      await conversationRepository.update(
        { customer_id: customerId, organization_id: organizationId },
        {
          customer_id: null,
          title: "[deleted]",
          context: null,
        },
      );

      // Anonymize and soft delete customer
      customer.email = `deleted-${customerId}@deleted.local`;
      customer.phone = null;
      customer.name = "[deleted]";
      customer.notes = null;
      customer.external_id = null;
      customer.external_metadata = null;

      await customerRepository.save(customer);

      // Hard delete the customer record
      await customerRepository.delete({ id: customerId, organization_id: organizationId });

      debugLog("privacy", `Customer data deleted`, {
        customerId,
        organizationId,
        conversationsAffected: conversations.length,
        embeddingsDeleted,
      });
    });
  }

  /**
   * Send verification email for customer privacy request
   */
  private async sendCustomerVerificationEmail(
    email: string,
    token: string,
    type: "export" | "deletion",
    organizationId: string,
    customerName?: string | null,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const verificationUrl = `${baseUrl}/privacy/verify?token=${token}&type=${type}`;

    const template = type === "export" ? "privacy-export-request" : "privacy-deletion-request";
    const subject =
      type === "export"
        ? "Verify Your Data Export Request"
        : "Verify Your Data Deletion Request";

    await emailService.sendTemplateEmail({
      to: email,
      subject,
      template,
      variables: {
        userName: customerName || email,
        verificationUrl,
        companyName: "Hay",
        expiresIn: `${this.VERIFICATION_EXPIRY_HOURS} hours`,
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Send customer export ready notification
   */
  private async sendCustomerExportReadyEmail(
    email: string,
    requestId: string,
    downloadToken: string,
    organizationId: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const downloadUrl = `${baseUrl}/privacy/download?requestId=${requestId}&token=${downloadToken}`;

    await emailService.sendTemplateEmail({
      to: email,
      subject: "Your Data Export is Ready",
      template: "privacy-export-ready",
      variables: {
        downloadUrl,
        expiresIn: `${this.EXPORT_EXPIRY_HOURS / 24} days`,
        companyName: "Hay",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Send customer deletion complete notification
   */
  private async sendCustomerDeletionCompleteEmail(
    email: string,
    organizationId: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();

    await emailService.sendTemplateEmail({
      to: email,
      subject: "Your Data Has Been Deleted",
      template: "privacy-deletion-complete",
      variables: {
        companyName: "Hay",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay Platform",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Anonymize IP address while preserving network prefix for analytics
   * IPv4: 192.168.1.100 -> 192.168.0.0 (keeps first 16 bits / class B network)
   * IPv6: 2001:0db8:85a3::8a2e -> 2001:0db8:0000:: (keeps first 48 bits / /48 prefix)
   */
  private anonymizeIpAddress(ip: string): string {
    if (ip.includes(":")) {
      // IPv6 handling
      try {
        // Handle special cases
        if (ip === "::1" || ip === "::") {
          return "0000:0000:0000::";
        }

        // Split and filter empty parts (from :: compression)
        const parts = ip.split(":").filter((p) => p !== "");

        // Ensure we have at least some parts to work with
        if (parts.length === 0) {
          return "0000:0000:0000::";
        }

        // Keep first 3 hextets (48 bits), zero out the rest
        const firstHextet = parts[0] || "0000";
        const secondHextet = parts[1] || "0000";
        const thirdHextet = parts[2] || "0000";

        return `${firstHextet}:${secondHextet}:${thirdHextet}::`;
      } catch (error) {
        // Safe fallback for any parsing errors
        console.warn("[Privacy] Failed to anonymize IPv6 address, using fallback", { ip, error });
        return "0000:0000:0000::";
      }
    } else {
      // IPv4 handling - keep first 16 bits (class B network)
      const parts = ip.split(".");

      // Validate IPv4 format
      if (parts.length !== 4) {
        console.warn("[Privacy] Invalid IPv4 address format, using fallback", { ip });
        return "0.0.0.0";
      }

      // Validate each octet is a number
      const octets = parts.map((p) => parseInt(p, 10));
      if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
        console.warn("[Privacy] Invalid IPv4 octet values, using fallback", { ip });
        return "0.0.0.0";
      }

      return `${octets[0]}.${octets[1]}.0.0`;
    }
  }

  /**
   * Recursively anonymize PII in JSON objects and arrays
   */
  private anonymizeJsonPii(obj: any): any {
    // Handle null/undefined
    if (!obj) {
      return obj;
    }

    // Handle arrays - recursively anonymize each element
    if (Array.isArray(obj)) {
      return obj.map((item) => this.anonymizeJsonPii(item));
    }

    // Handle primitives (string, number, boolean, etc.)
    if (typeof obj !== "object") {
      return obj;
    }

    // Handle objects - check for sensitive fields and recurse
    const sensitiveFields = [
      "email",
      "phone",
      "phoneNumber",
      "firstName",
      "lastName",
      "name",
      "address",
      "ssn",
      "password",
      "token",
      "apiKey",
      "creditCard",
      "bankAccount",
      "ipAddress",
      "userAgent",
    ];

    const anonymized = { ...obj };

    for (const key in anonymized) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field.toLowerCase()))) {
        // Redact sensitive fields
        anonymized[key] = "[REDACTED]";
      } else if (anonymized[key] !== null && typeof anonymized[key] === "object") {
        // Recursively anonymize nested objects and arrays
        anonymized[key] = this.anonymizeJsonPii(anonymized[key]);
      }
    }

    return anonymized;
  }

  /**
   * Clean up expired privacy export files
   * Called by scheduled job: 'cleanup-expired-privacy-exports'
   * Deletes export files older than 7 days (supports both JSON and ZIP formats)
   */
  async cleanupExpiredExports(): Promise<void> {
    const { config } = await import("@server/config/env");
    const retentionDays = config.privacy.exportRetentionDays;

    const exportsDir = path.join(__dirname, "../../exports");
    let deletedCount = 0;
    let errorCount = 0;

    try {
      // Ensure directory exists
      await fs.mkdir(exportsDir, { recursive: true });

      const files = await fs.readdir(exportsDir);

      for (const file of files) {
        // Process both JSON and ZIP files
        if (!file.endsWith(".json") && !file.endsWith(".zip")) continue;

        try {
          const filePath = path.join(exportsDir, file);
          const stats = await fs.stat(filePath);
          const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

          if (ageInDays > retentionDays) {
            await fs.unlink(filePath);
            deletedCount++;
            debugLog("privacy", `Deleted expired export: ${file}`, {
              ageInDays: Math.round(ageInDays),
            });
          }
        } catch (error) {
          errorCount++;
          console.error(`[Privacy] Error processing file ${file}:`, error);
        }
      }

      console.log(
        `[Privacy] Cleanup complete: ${deletedCount} files deleted, ${errorCount} errors`,
      );
    } catch (error) {
      console.error("[Privacy] Failed to cleanup expired exports:", error);
      throw error;
    }
  }
}

// Export singleton instance
export const privacyService = new PrivacyService();
