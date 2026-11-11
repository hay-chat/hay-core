import { AppDataSource } from "@server/database/data-source";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import type {
  PrivacyRequestType,
  PrivacyRequestIdentifierType,
} from "@server/entities/privacy-request.entity";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { AuditLog } from "@server/entities/audit-log.entity";
import type { AuditAction } from "@server/entities/audit-log.entity";
import { Document } from "@server/entities/document.entity";
import { Upload } from "@server/entities/upload.entity";
import { Job, JobStatus, JobPriority } from "@server/entities/job.entity";
import { Customer } from "@server/database/entities/customer.entity";
import { Conversation } from "@server/database/entities/conversation.entity";
import { Message } from "@server/database/entities/message.entity";
import type { EntityManager } from "typeorm";

import { emailService, getOrganizationLocale } from "./email.service";
import { auditLogService } from "./audit-log.service";
import { vectorStoreService } from "./vector-store.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("privacy");
import * as crypto from "crypto";
import { createWriteStream } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as archiver from "archiver";
import { config, getDashboardUrl } from "@server/config/env";
import { IsNull } from "typeorm";
import type { ExportPackageData } from "@server/types/privacy.types";
import { PRIVACY_DELETION_JOB_TYPE, PRIVACY_EXPORT_JOB_TYPE } from "@server/types/privacy.types";
import { NO_RECIPIENT_ERROR, organizationAdminEmails } from "./provider-privacy.service";
import { storageService } from "@server/services/storage.service";
import { deleteConversationMedia } from "@server/services/conversation-media.service";
import { anonymizeConversations } from "@server/services/conversation-anonymizer";
import { recordErasure } from "@server/services/erasure-ledger";
import { isUuid } from "@server/services/media-url.service";
import { fetchPublicFile } from "@server/utils/fetch-public-file";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";

/** Job `data.type` values run by the background job queue (job-queue.service). */
const PRIVACY_JOB_TYPES = [PRIVACY_EXPORT_JOB_TYPE, PRIVACY_DELETION_JOB_TYPE];
/** Private upload folder for export ZIPs; read only through downloadExport. */
export const PRIVACY_EXPORT_FOLDER = "privacy-exports";
/** A privacy job "processing" longer than this died with its server and is queued again. */
const STALE_PROCESSING_MS = 2 * 60 * 60 * 1000;
/** A job requeued this many times is failed instead. */
const MAX_JOB_ATTEMPTS = 3;
/**
 * Finished privacy requests keep the requester's email, IP address and user
 * agent this long (proof the request was handled), then they are anonymized.
 */
export const PRIVACY_REQUEST_RETENTION_DAYS = 365;
const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;
/** Attachment files stop being added past this total. */
const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;
const REMOTE_ATTACHMENT_FETCH = { maxBytes: 25 * 1024 * 1024, timeoutMs: 15_000 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** An email or phone shorter than this would match unrelated text. */
const MIN_IDENTITY_NEEDLE_LENGTH = 7;

/** $2 holds lowercase needles; `text` is SQL built from fixed column names only. */
const TEXT_MATCHES = (text: string): string =>
  `EXISTS (SELECT 1 FROM unnest($2::text[]) AS needle WHERE position(needle IN lower(${text})) > 0)`;

/** $3 holds conversation and message ids; a replay ref is `conversation:<id>:<turn>`. */
const SOURCE_REF_MATCHES = `(source_ref = ANY($3::text[])
  OR substring(source_ref from '^conversation:([0-9a-f-]{36}):') = ANY($3::text[]))`;

const CANCELLABLE_STATUSES = ["pending_verification", "verified", "processing"];

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against a stored SHA-256 hash. */
function tokenMatches(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const presented = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
}

/** What a privacy request keeps of the requester's email once it is anonymized. */
export function erasedEmail(email: string): string {
  return `erased:${hashToken(email.toLowerCase())}`;
}

/**
 * Privacy Service
 * Handles GDPR Data Subject Access Requests (DSAR)
 */
/** A refusal whose message is written for the person making the request. */
export class PrivacyRequestError extends Error {}

export class PrivacyService {
  private readonly VERIFICATION_EXPIRY_HOURS = 24;

  /** Days an export ZIP (and its download link) is kept. */
  private get exportRetentionDays(): number {
    return config.privacy.exportRetentionDays;
  }

  private async checkPublicRateLimits(email: string, ipAddress?: string): Promise<void> {
    // Defense in depth - also checked at router level
    if (!ipAddress) return;
    const { rateLimitService } = await import("./rate-limit.service");
    const ipLimit = await rateLimitService.checkIpRateLimit(ipAddress, 10, 3600, {
      scope: "privacy-request",
    });
    const emailLimit = await rateLimitService.checkEmailRateLimit(email, 3, 86400, {
      scope: "privacy-request",
    });
    const combinedLimit = await rateLimitService.checkCombinedRateLimit(ipAddress, email, 2, 86400);
    if (ipLimit.limited || emailLimit.limited || combinedLimit.limited) {
      throw new PrivacyRequestError("Rate limit exceeded. Please try again later.");
    }
  }

  /**
   * Request a data export
   */
  async requestExport(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    return this.requestForUser("export", email, ipAddress, userAgent);
  }

  /**
   * Request data deletion
   */
  async requestDeletion(
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    return this.requestForUser("deletion", email, ipAddress, userAgent);
  }

  /**
   * Start a staff-user request. The answer is the same whether or not an
   * account uses this email: a request row is always created, but the
   * verification email only goes to an address that has an account.
   */
  private async requestForUser(
    type: "export" | "deletion",
    email: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    email = email.toLowerCase();
    await this.checkPublicRateLimits(email, ipAddress);

    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const user = await AppDataSource.getRepository(User).findOne({
      where: { email, deletedAt: IsNull() },
    });

    // Generate verification token (SHA-256 for high-entropy tokens — enables O(1) DB lookup)
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    const request = requestRepository.create({
      email,
      userId: user?.id,
      type,
      status: "pending_verification",
      verificationTokenHash: hashToken(verificationToken),
      verificationExpiresAt: expiresAt,
      ipAddress,
      userAgent,
      maxDownloads: config.privacy.maxDownloadCount,
    });
    await requestRepository.save(request);

    await this.logPrivacyAction(`privacy.${type}.request`, user?.id, {
      requestId: request.id,
      ipAddress,
      userAgent,
    });

    if (user) {
      try {
        await this.sendVerificationEmail(email, verificationToken, type, user.firstName);
      } catch (error) {
        logger.error({ err: error }, "Failed to send verification email");
        request.status = "failed";
        request.errorMessage = "Failed to send verification email. Please try again.";
        await requestRepository.save(request);
        throw new PrivacyRequestError("Failed to send verification email. Please try again later.");
      }
    }

    logger.debug({ requestId: request.id, type, hasUser: !!user }, "Privacy request created");
    return { requestId: request.id, expiresAt };
  }

  /**
   * Confirm a data export with its verification token (staff user or customer)
   */
  async confirmExport(token: string): Promise<{ requestId: string; jobId: string }> {
    return this.confirmRequest(token, "export");
  }

  /**
   * Confirm a data deletion with its verification token (staff user or customer)
   */
  async confirmDeletion(token: string): Promise<{ requestId: string; jobId: string }> {
    return this.confirmRequest(token, "deletion");
  }

  /**
   * Verify the token and queue the background job. The verification link in
   * both the staff and the customer emails lands here.
   */
  private async confirmRequest(
    token: string,
    type: "export" | "deletion",
  ): Promise<{ requestId: string; jobId: string }> {
    const outcome = await AppDataSource.transaction(async (manager) => {
      const requestRepository = manager.getRepository(PrivacyRequest);
      // The row lock makes a second confirmation of the same token wait, then miss.
      const request = await requestRepository.findOne({
        where: {
          type,
          status: "pending_verification",
          verificationTokenHash: hashToken(token),
        },
        lock: { mode: "pessimistic_write" },
      });

      if (!request) return { error: "Invalid or expired verification token" };

      if (request.isExpired()) {
        request.status = "expired";
        await requestRepository.save(request);
        return { error: "Verification token has expired" };
      }

      const subjectId = request.isCustomerRequest() ? request.customerId : request.userId;
      const organizationId =
        request.organizationId ?? (await this.primaryOrganizationId(manager, request.userId));
      if (!subjectId || !organizationId) {
        return { error: "Invalid or expired verification token" };
      }

      request.markVerified();
      const job = await manager.getRepository(Job).save(
        manager.getRepository(Job).create({
          title: type === "export" ? "Privacy data export" : "Privacy data deletion",
          description: "Data subject request",
          status: JobStatus.QUEUED,
          priority: type === "export" ? JobPriority.HIGH : JobPriority.CRITICAL,
          organizationId,
          data: {
            type: type === "export" ? PRIVACY_EXPORT_JOB_TYPE : PRIVACY_DELETION_JOB_TYPE,
            requestId: request.id,
          },
        }),
      );
      request.markProcessing(job.id);
      await requestRepository.save(request);
      return { request, jobId: job.id };
    });

    if ("error" in outcome) throw new PrivacyRequestError(outcome.error);
    const { request, jobId } = outcome;

    await this.logPrivacyAction(this.actionName(request, "confirm"), request.userId, {
      requestId: request.id,
      jobId,
      organizationId: request.organizationId,
      customerId: request.customerId,
    });

    logger.debug({ requestId: request.id, jobId }, "Privacy request confirmed");
    return { requestId: request.id, jobId };
  }

  /** The organization a staff user's job is filed under: their current one, else any membership. */
  private async primaryOrganizationId(
    manager: EntityManager,
    userId: string | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (user?.organizationId) return user.organizationId;
    const membership = await manager
      .getRepository(UserOrganization)
      .findOne({ where: { userId }, order: { createdAt: "ASC" } });
    return membership?.organizationId ?? null;
  }

  private actionName(request: PrivacyRequest, step: string): string {
    const prefix = request.isCustomerRequest() ? "customer.privacy" : "privacy";
    return `${prefix}.${request.type}.${step}`;
  }

  /**
   * Run a claimed privacy job (job-queue.service, BACKGROUND_JOB_TYPES). A
   * failure marks the request failed and is rethrown so the queue fails the job.
   */
  async processJob(job: Job): Promise<Record<string, unknown>> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const requestId = job.data?.requestId as string | undefined;
    const request = requestId
      ? await requestRepository.findOne({ where: { id: requestId } })
      : null;
    if (!request) throw new Error("Privacy request not found");
    if (request.status === "cancelled") return { cancelled: true };

    try {
      if (request.type === "export") return await this.runExport(request, job.organizationId);
      if (request.type === "deletion") return await this.runDeletion(request);
      throw new Error(`Unsupported privacy request type: ${request.type}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error({ err: error, requestId: request.id }, "Privacy job failed");
      request.setError(errorMessage);
      await requestRepository.update(request.id, {
        status: request.status,
        errorMessage: request.errorMessage,
        completedAt: request.completedAt,
      });
      throw error;
    }
  }

  private async runExport(
    request: PrivacyRequest,
    organizationId: string,
  ): Promise<Record<string, unknown>> {
    const exportData = request.isCustomerRequest()
      ? await this.collectCustomerData(request.customerId!, request.organizationId!)
      : await this.collectUserData(request.userId!);

    const { buffer, signature } = await this.createSignedZipExport(
      exportData,
      request.id,
      organizationId,
    );
    const { upload } = await storageService.upload({
      buffer,
      originalName: `data-export-${new Date().toISOString().slice(0, 10)}.zip`,
      mimeType: "application/zip",
      folder: PRIVACY_EXPORT_FOLDER,
      organizationId,
      maxSize: MAX_EXPORT_BYTES,
    });

    const downloadToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + this.exportRetentionDays * DAY_MS);

    // Without the email the link can never be used, so the file goes too.
    try {
      if (request.metadata?.source) {
        await this.sendMerchantExportReadyEmail(request, downloadToken);
      } else {
        await this.sendExportReadyEmail(
          request.email,
          request.id,
          downloadToken,
          request.organizationId,
        );
      }
    } catch (error) {
      await storageService.delete(upload.id).catch(() => undefined);
      throw error;
    }

    request.setExportMetadata(upload.id, hashToken(downloadToken), expiresAt);
    request.metadata = { ...request.metadata, signature };
    request.markCompleted();
    await AppDataSource.getRepository(PrivacyRequest).save(request);

    await this.logPrivacyAction(this.actionName(request, "complete"), request.userId, {
      requestId: request.id,
      organizationId: request.organizationId,
      customerId: request.customerId,
    });
    logger.debug({ requestId: request.id, uploadId: upload.id }, "Export completed");
    return { uploadId: upload.id, expiresAt: expiresAt.toISOString() };
  }

  private async runDeletion(request: PrivacyRequest): Promise<Record<string, unknown>> {
    const email = request.email;
    if (request.isCustomerRequest()) {
      // customer_id is cleared when the customer is deleted: already erased.
      if (request.customerId) {
        await this.executeCustomerDeletion(request.customerId, request.organizationId!);
      }
    } else {
      await this.executeDataDeletion(request.userId!);
    }

    // update(), not save(): the erased customer's id is no longer a valid reference.
    request.markCompleted();
    await AppDataSource.getRepository(PrivacyRequest).update(request.id, {
      status: request.status,
      completedAt: request.completedAt,
    });

    await this.logPrivacyAction(this.actionName(request, "complete"), undefined, {
      requestId: request.id,
      organizationId: request.organizationId,
      customerId: request.customerId,
    });

    // A provider-initiated erasure is confirmed to the subject by the provider.
    if (email && !request.metadata?.source) {
      await this.sendDeletionCompleteEmail(email, request.organizationId).catch((error) =>
        logger.error({ err: error, requestId: request.id }, "Failed to send deletion email"),
      );
    }

    // The confirmation is sent: the subject's own requests keep no contact details.
    await this.anonymizeRequests(
      AppDataSource.manager,
      request.isCustomerRequest()
        ? { customerId: request.customerId!, email }
        : { userId: request.userId!, email },
    );

    logger.debug({ requestId: request.id }, "Deletion completed");
    return { deletedAt: new Date().toISOString() };
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
  }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
      relations: { job: true },
    });

    if (!request) {
      throw new PrivacyRequestError("Privacy request not found");
    }

    return {
      id: request.id,
      type: request.type,
      status: request.status,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      jobId: request.jobId,
      jobStatus: request.job?.status,
      downloadAvailable: this.isDownloadAvailable(request),
    };
  }

  private isDownloadAvailable(request: PrivacyRequest, now = new Date()): boolean {
    const expiresAt = request.getExportExpiresAt();
    return (
      request.type === "export" &&
      request.status === "completed" &&
      !!request.getExportUploadId() &&
      !!expiresAt &&
      expiresAt > now &&
      request.downloadCount < request.maxDownloads
    );
  }

  /**
   * Cancel a privacy request
   * Only pending_verification, verified or processing requests can be cancelled
   */
  async cancelRequest(requestId: string, token: string, ipAddress?: string): Promise<void> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const jobRepository = AppDataSource.getRepository(Job);

    const request = await requestRepository.findOne({ where: { id: requestId } });
    if (!request) {
      throw new PrivacyRequestError("Privacy request not found");
    }

    if (!request.verificationTokenHash) {
      throw new PrivacyRequestError("This request cannot be cancelled (no verification token)");
    }
    if (!tokenMatches(token, request.verificationTokenHash)) {
      throw new PrivacyRequestError("Invalid verification token");
    }

    if (!CANCELLABLE_STATUSES.includes(request.status)) {
      throw new PrivacyRequestError(
        `Cannot cancel request with status '${request.status}'. ` +
          `Only pending, verified, or processing requests can be cancelled.`,
      );
    }

    if (request.jobId) {
      const job = await jobRepository.findOne({ where: { id: request.jobId } });
      if (job && job.status !== JobStatus.COMPLETED && job.status !== JobStatus.FAILED) {
        job.status = JobStatus.CANCELLED;
        await jobRepository.save(job);
      }
    }

    request.status = "cancelled";
    await requestRepository.save(request);

    await this.logPrivacyAction("privacy.request.cancelled", request.userId, {
      requestId: request.id,
      type: request.type,
      ipAddress,
    });

    logger.debug({ requestId, type: request.type }, "Privacy request cancelled");
  }

  /**
   * Download an export ZIP. Each successful call uses one of the request's
   * allowed downloads; the file is deleted after the last one.
   */
  async downloadExport(
    requestId: string,
    downloadToken: string,
    ipAddress?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId, type: "export", status: "completed" },
    });

    if (!request) {
      throw new PrivacyRequestError("Export request not found or not ready");
    }

    if (!tokenMatches(downloadToken, request.getDownloadTokenHash())) {
      throw new PrivacyRequestError("Invalid download token");
    }

    const expiresAt = request.getExportExpiresAt();
    const uploadId = request.getExportUploadId();
    if (!uploadId || !expiresAt || expiresAt <= new Date()) {
      throw new PrivacyRequestError("Export has expired");
    }

    // Check IP restriction (optional - can be disabled for mobile users)
    if (
      config.privacy.downloadIpRestriction &&
      ipAddress &&
      request.downloadIpAddress &&
      request.downloadIpAddress !== ipAddress
    ) {
      await this.logPrivacyAction("privacy.download.ip_mismatch", request.userId, {
        requestId,
        originalIp: request.downloadIpAddress,
        attemptedIp: ipAddress,
      });

      throw new PrivacyRequestError(
        "Security validation failed. Please download from the same device/network " +
          "used to request the export.",
      );
    }

    // Claim a download atomically so concurrent requests can't exceed the limit.
    // Note: maxDownloads is fixed at request creation time on purpose.
    const [claimed]: [Array<{ download_count: number }>, number] = await AppDataSource.query(
      `UPDATE privacy_requests
       SET download_count = download_count + 1,
           downloaded_at = COALESCE(downloaded_at, now()),
           download_ip_address = COALESCE(download_ip_address, $2)
       WHERE id = $1 AND download_count < max_downloads
       RETURNING download_count`,
      [request.id, ipAddress ?? null],
    );
    if (!claimed?.length) {
      throw new PrivacyRequestError(
        "Download limit exceeded. This link has already been used. " +
          "Please request a new export if needed.",
      );
    }
    request.downloadCount = claimed[0].download_count;

    const { buffer } = await storageService.download(uploadId);

    if (request.downloadCount >= request.maxDownloads) {
      await this.deleteExportFile(request);
    }

    await this.logPrivacyAction("privacy.export.download", request.userId, {
      requestId: request.id,
      downloadCount: request.downloadCount,
      ipAddress,
    });

    return { buffer, fileName: `data-export-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  /** Remove an export's ZIP; the request row stays as the record. */
  private async deleteExportFile(request: PrivacyRequest): Promise<void> {
    const uploadId = request.getExportUploadId();
    if (!uploadId) return;
    try {
      await storageService.delete(uploadId);
    } catch (error) {
      logger.warn({ err: error, requestId: request.id }, "Could not delete an export file");
      return;
    }
    await AppDataSource.query(
      `UPDATE privacy_requests SET metadata = metadata - 'uploadId' WHERE id = $1`,
      [request.id],
    );
  }

  /**
   * Collect all user data for export, across every organization they belong to
   */
  private async collectUserData(userId: string): Promise<ExportPackageData> {
    const userRepository = AppDataSource.getRepository(User);
    const auditLogRepository = AppDataSource.getRepository(AuditLog);
    const documentRepository = AppDataSource.getRepository(Document);
    const uploadRepository = AppDataSource.getRepository(Upload);

    const user = await userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    const memberships = await AppDataSource.getRepository(UserOrganization).find({
      where: { userId },
      relations: { organization: true },
      order: { createdAt: "ASC" },
    });

    const auditLogs = await auditLogRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 1000, // Limit to last 1000 events
    });

    const documents = await documentRepository.find({
      where: [{ createdBy: userId }, { updatedBy: userId }],
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
        attachments: true,
      },
    });

    const uploads = await uploadRepository.find({
      where: { uploadedById: userId },
      order: { createdAt: "DESC" },
    });

    return {
      exportDate: new Date().toISOString(),
      exportVersion: "2.0",
      dataSubject: {
        email: user.email,
        userId: user.id,
      },
      personalData: {
        profile: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          lastSeenAt: user.lastSeenAt,
          status: user.status,
        },
        organizations: memberships.map((membership) => ({
          id: membership.organizationId,
          name: membership.organization?.name,
          role: membership.role,
          permissions: membership.permissions ?? [],
          isActive: membership.isActive,
          joinedAt: membership.joinedAt,
          lastAccessedAt: membership.lastAccessedAt,
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
          attachments: doc.attachments || [],
        })),
        uploads: uploads.map((upload) => ({
          id: upload.id,
          filename: upload.filename,
          originalName: upload.originalName,
          path: upload.path,
          mimeType: upload.mimeType,
          size: upload.size,
          folder: upload.folder,
          createdAt: upload.createdAt,
        })),
        statistics: {
          totalOrganizations: memberships.length,
          totalDocuments: documents.length,
          totalUploads: uploads.length,
          totalAuditLogs: auditLogs.length,
        },
      },
    };
  }

  /**
   * Erase a staff user: every row that identifies them is deleted or cleared,
   * and the user row itself is kept only as an anonymous placeholder (other
   * rows such as takeover events still point at it).
   */
  private async executeDataDeletion(userId: string): Promise<void> {
    let avatarUrl: string | undefined;

    await AppDataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const auditLogRepository = manager.getRepository(AuditLog);

      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }
      const email = user.email.toLowerCase();
      avatarUrl = user.avatarUrl ?? undefined;

      // Anonymize audit logs (keep for compliance but remove PII)
      const auditLogs = await auditLogRepository.find({ where: { userId } });
      for (const log of auditLogs) {
        // The entity types userId as `string | undefined`, but the DB column is
        // nullable, so we explicitly null it to erase the association.
        log.userId = null as unknown as undefined;
        if (log.ipAddress) {
          log.ipAddress = this.anonymizeIpAddress(log.ipAddress);
        }
        if (log.userAgent) {
          log.userAgent = "deleted";
        }
        if (log.changes) {
          log.changes = this.anonymizeJsonPii(log.changes) as Record<string, unknown>;
        }
        if (log.metadata) {
          log.metadata = this.anonymizeJsonPii(log.metadata) as Record<string, unknown>;
        }
        await auditLogRepository.save(log);
      }

      // Rows that exist only for this person: sign-ins, devices, one-time codes,
      // alert deliveries, memberships in every organization, invitations to them.
      await manager.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM auth_codes WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM notification_deliveries WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]);
      await manager.query(
        `DELETE FROM organization_invitations WHERE invited_user_id = $1 OR lower(email) = $2`,
        [userId, email],
      );

      // Every nullable reference to the user (uploader, assignee, author,
      // approver, …) is cleared. Read from the schema so a new table with a
      // user reference is covered without a change here. Audit logs are handled
      // above and privacy requests keep their link as the record of this erasure.
      const references: Array<{ table_name: string; column_name: string }> = await manager.query(
        `SELECT kcu.table_name, kcu.column_name
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = rc.constraint_name AND ccu.constraint_schema = rc.constraint_schema
         WHERE ccu.table_name = 'users' AND ccu.column_name = 'id'
           AND rc.delete_rule = 'SET NULL'
           AND kcu.table_schema = current_schema()
           AND kcu.table_name NOT IN ('audit_logs', 'privacy_requests')`,
      );
      for (const { table_name, column_name } of references) {
        await manager.query(
          `UPDATE "${table_name}" SET "${column_name}" = NULL WHERE "${column_name}" = $1`,
          [userId],
        );
      }

      // Replies they sent in conversations carry their name.
      await manager.query(
        `UPDATE messages
         SET sender = '[deleted]', metadata = metadata - 'agentFirstName'
         WHERE type = 'HumanAgent'
           AND (metadata->>'sentByUserId' = $1 OR metadata->>'answeredBy' = $1)`,
        [userId],
      );

      user.softDelete();
      user.isActive = false;
      user.email = `deleted-${userId}@deleted.local`;
      // Nullable columns are typed `string | undefined`; null them to erase the PII.
      user.firstName = null as unknown as undefined;
      user.lastName = null as unknown as undefined;
      user.avatarUrl = null as unknown as undefined;
      user.pendingEmail = null;
      user.metadata = null as unknown as undefined;
      user.organizationId = null as unknown as undefined;
      user.password = "deleted";
      // Access tokens already issued stop working.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await userRepository.save(user);
      await recordErasure(manager, { subjectType: "user", subjectId: userId });

      logger.debug({ userId }, "User data deleted");
    });

    // A deleted file can't be rolled back, so it goes once the erasure committed.
    if (avatarUrl) {
      try {
        await storageService.deleteByPublicUrl(avatarUrl, "avatars", userId);
      } catch (error) {
        logger.warn({ err: error, userId }, "Failed to delete an erased user's avatar");
      }
    }
  }

  /**
   * Remove the contact details from a subject's privacy requests: the email is
   * replaced by its hash (so a repeat request can still be matched to this
   * record), network details and identifiers are dropped.
   */
  private async anonymizeRequests(
    manager: EntityManager,
    subject: { userId?: string; customerId?: string; email: string },
  ): Promise<void> {
    await manager.query(
      `UPDATE privacy_requests
       SET email = coalesce($1, email), identifier_value = NULL, ip_address = NULL,
           user_agent = NULL, download_ip_address = NULL
       WHERE (user_id = $2 OR customer_id = $3 OR lower(email) = $4)
         AND email NOT LIKE 'erased:%'
         AND status NOT IN ('pending_verification', 'verified', 'processing')`,
      // A provider-initiated request may have no email: match it by subject only.
      [
        subject.email ? erasedEmail(subject.email) : null,
        subject.userId ?? null,
        subject.customerId ?? null,
        subject.email ? subject.email.toLowerCase() : null,
      ],
    );
  }

  /**
   * Send verification email
   */
  private async sendVerificationEmail(
    email: string,
    token: string,
    type: "export" | "deletion",
    recipientName?: string | null,
    organizationId?: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const verificationUrl = `${baseUrl}/privacy/verify?token=${token}&type=${type}`;

    const template = type === "export" ? "privacy-export-request" : "privacy-deletion-request";
    const locale = await getOrganizationLocale(organizationId);

    await emailService.sendTemplateEmail({
      to: email,
      template,
      locale,
      variables: {
        userName: recipientName || email,
        verificationUrl,
        companyName: "Hay.chat",
        expiresIn: `${this.VERIFICATION_EXPIRY_HOURS} hours`,
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay.chat",
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
    organizationId?: string,
  ): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const downloadUrl = `${baseUrl}/privacy/download?requestId=${requestId}&token=${downloadToken}`;
    const locale = await getOrganizationLocale(organizationId);

    await emailService.sendTemplateEmail({
      to: email,
      template: "privacy-export-ready",
      locale,
      variables: {
        downloadUrl,
        expiresIn: `${this.exportRetentionDays} days`,
        companyName: "Hay.chat",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay.chat",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * A provider-requested export (a store's customers/data_request) goes to
   * the organization's owners and admins: the store is the controller and
   * answers its shopper. They are asked to forward it; the shopper is never
   * emailed.
   */
  private async sendMerchantExportReadyEmail(
    request: PrivacyRequest,
    downloadToken: string,
  ): Promise<void> {
    const organizationId = request.organizationId!;
    const recipients = await organizationAdminEmails(organizationId);
    if (recipients.length === 0) throw new Error(NO_RECIPIENT_ERROR);

    const customer = request.customerId
      ? await AppDataSource.getRepository(Customer).findOne({
          where: { id: request.customerId, organization_id: organizationId },
        })
      : null;
    const customerLabel =
      [customer?.name, customer?.email ?? customer?.phone].filter(Boolean).join(" · ") ||
      "Customer";
    const reference =
      typeof request.metadata?.reference === "string" ? request.metadata.reference : request.id;

    await emailService.initialize();
    const baseUrl = getDashboardUrl();
    const downloadUrl = `${baseUrl}/privacy/download?requestId=${request.id}&token=${downloadToken}`;
    const locale = await getOrganizationLocale(organizationId);

    for (const to of recipients) {
      await emailService.sendTemplateEmail({
        to,
        template: "privacy-export-ready-merchant",
        locale,
        variables: {
          downloadUrl,
          customerLabel,
          customerId: request.customerId ?? "",
          requestReference: reference,
          expiresIn: `${this.exportRetentionDays} days`,
          companyName: "Hay.chat",
          supportUrl: `${baseUrl}/support`,
          currentYear: new Date().getFullYear().toString(),
          companyAddress: "Hay.chat",
          websiteUrl: baseUrl,
          recipientEmail: to,
        },
      });
    }
  }

  /**
   * Send deletion complete notification
   */
  private async sendDeletionCompleteEmail(email: string, organizationId?: string): Promise<void> {
    await emailService.initialize();

    const baseUrl = getDashboardUrl();
    const locale = await getOrganizationLocale(organizationId);

    await emailService.sendTemplateEmail({
      to: email,
      template: "privacy-deletion-complete",
      locale,
      variables: {
        companyName: "Hay.chat",
        supportUrl: `${baseUrl}/support`,
        currentYear: new Date().getFullYear().toString(),
        companyAddress: "Hay.chat",
        websiteUrl: baseUrl,
        recipientEmail: email,
      },
    });
  }

  /**
   * Log privacy action to audit log. The requester's email is not written:
   * the requestId points at the privacy request, which holds it.
   */
  private async logPrivacyAction(
    action: string,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await auditLogService.log({
        // Customers and unverified requesters are not users: no user reference,
        // the requestId in `changes` points at the request.
        userId,
        organizationId:
          typeof metadata?.organizationId === "string" ? metadata.organizationId : undefined,
        // Privacy logging uses a broader action vocabulary than the core
        // AuditAction union (e.g. customer.* and ip_mismatch events). The DB
        // column is a plain varchar, so widening here is safe.
        action: action as AuditAction,
        resource: "privacy_request",
        changes: { ...metadata },
        status: "success",
        ipAddress: typeof metadata?.ipAddress === "string" ? metadata.ipAddress : undefined,
        userAgent: typeof metadata?.userAgent === "string" ? metadata.userAgent : undefined,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to log audit action");
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
  ): Promise<{ requestId: string; expiresAt: Date }> {
    return this.requestForCustomer("export", organizationId, identifier, ipAddress, userAgent);
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
    return this.requestForCustomer("deletion", organizationId, identifier, ipAddress, userAgent);
  }

  /**
   * Start a customer request on the organization's behalf. The verification
   * email only goes to the address stored on the customer record.
   */
  private async requestForCustomer(
    type: "export" | "deletion",
    organizationId: string,
    identifier: { type: PrivacyRequestIdentifierType; value: string },
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ requestId: string; expiresAt: Date }> {
    const requestRepository = AppDataSource.getRepository(PrivacyRequest);

    const customer = await this.findCustomer(organizationId, identifier);
    if (!customer) {
      throw new Error("No customer found with this identifier");
    }
    if (!customer.email) {
      throw new Error("Cannot send verification email: no email address available");
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + this.VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    const request = requestRepository.create({
      email: customer.email,
      customerId: customer.id,
      organizationId,
      type,
      subjectType: "customer",
      status: "pending_verification",
      verificationTokenHash: hashToken(verificationToken),
      verificationExpiresAt: expiresAt,
      identifierType: identifier.type,
      identifierValue: identifier.value,
      ipAddress,
      userAgent,
      maxDownloads: config.privacy.maxDownloadCount,
    });
    await requestRepository.save(request);

    await this.logPrivacyAction(`customer.privacy.${type}.request`, undefined, {
      requestId: request.id,
      organizationId,
      customerId: customer.id,
      identifierType: identifier.type,
      ipAddress,
      userAgent,
    });

    await this.sendVerificationEmail(
      customer.email,
      verificationToken,
      type,
      customer.name,
      organizationId,
    );

    logger.debug(
      { requestId: request.id, organizationId, customerId: customer.id, type },
      "Customer privacy request created",
    );
    return { requestId: request.id, expiresAt };
  }

  /** Erase a staff user outside a request, when an erasure is replayed after a restore. */
  async eraseUser(userId: string): Promise<void> {
    const user = await AppDataSource.getRepository(User).findOneOrFail({ where: { id: userId } });
    const email = user.email;
    await this.executeDataDeletion(userId);
    await this.anonymizeRequests(AppDataSource.manager, { userId, email });
  }

  /**
   * Erase a customer from the dashboard (Customers → Delete): the same erasure
   * a verified customer deletion request runs. Returns false when the customer
   * is not in the organization.
   */
  async eraseCustomer(customerId: string, organizationId: string): Promise<boolean> {
    const customer = await AppDataSource.getRepository(Customer).findOne({
      where: { id: customerId, organization_id: organizationId },
    });
    if (!customer) return false;
    const email = customer.email;
    await this.executeCustomerDeletion(customerId, organizationId);
    if (email) {
      await this.anonymizeRequests(AppDataSource.manager, { customerId, email });
    }
    // TODO: audit event for dashboard-initiated customer erasure (audit-log coverage work).
    return true;
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
   * Collect all customer data for export
   * GDPR Article 15 - Right of Access
   * Traverses: customers → conversations → messages → embeddings
   */
  private async collectCustomerData(
    customerId: string,
    organizationId: string,
  ): Promise<ExportPackageData> {
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
    const embeddings: Array<{
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
      logger.debug({ error }, "Error collecting embeddings for export");
      // Continue without embeddings - they might not exist
    }

    const linkedRecords = await this.collectLinkedCustomerRecords(
      organizationId,
      conversationIds,
      customer,
    );

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
        ...linkedRecords,
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
              sum +
              conv.messages.reduce((msgSum, msg) => msgSum + (msg.attachments?.length || 0), 0),
            0,
          ),
          totalEmbeddings: embeddings.length,
        },
      },
    };
  }

  /**
   * Build the signed ZIP (data.json, README.md, manifest.json, signature.txt
   * and the subject's files). Files are read from storage only when they
   * belong to the export's organization; remote attachment URLs go through
   * fetchPublicFile (SSRF check, timeout, size cap).
   */
  private async createSignedZipExport(
    exportData: ExportPackageData,
    requestId: string,
    organizationId: string,
  ): Promise<{ buffer: Buffer; signature: string }> {
    const attachments: Array<{
      messageId: string;
      conversationId: string;
      id: string;
      name: string;
      url: string;
      type: string;
      size: number;
    }> = [];

    for (const conv of exportData.personalData?.conversations ?? []) {
      for (const msg of conv.messages || []) {
        for (const attachment of msg.attachments || []) {
          attachments.push({ messageId: msg.id, conversationId: conv.id, ...attachment });
        }
      }
    }

    const downloadedFiles: Array<{ path: string; buffer: Buffer; source: string }> = [];
    let totalBytes = 0;
    const add = (file: { path: string; buffer: Buffer; source: string }) => {
      if (totalBytes + file.buffer.length > MAX_ATTACHMENT_BYTES) return;
      totalBytes += file.buffer.length;
      downloadedFiles.push(file);
    };

    for (const attachment of attachments) {
      const zipPath = `attachments/${attachment.conversationId}/${attachment.id}_${safeFileName(attachment.name)}`;
      try {
        const stored = isUuid(attachment.id)
          ? await this.readStoredFile(attachment.id, organizationId)
          : null;
        if (stored) {
          add({ path: zipPath, buffer: stored, source: attachment.url });
        } else if (/^https?:\/\//i.test(attachment.url)) {
          const { buffer } = await fetchPublicFile(attachment.url, REMOTE_ATTACHMENT_FETCH);
          add({ path: zipPath, buffer, source: attachment.url });
        }
      } catch (err) {
        logger.debug({ attachmentId: attachment.id, error: err }, "Could not include attachment");
      }
    }

    const userUploads = exportData.personalData?.uploads ?? [];
    for (const upload of userUploads) {
      const stored = await this.readStoredFile(upload.id, organizationId, true);
      if (stored) {
        add({
          path: `uploads/${upload.folder}/${upload.id}_${safeFileName(upload.originalName)}`,
          buffer: stored,
          source: upload.id,
        });
      }
    }

    const dataJson = JSON.stringify(exportData, null, 2);
    const included = new Set(downloadedFiles.map((f) => f.source));

    const manifest = {
      version: "2.0",
      exportId: requestId,
      exportDate: exportData.exportDate,
      dataSubject: exportData.dataSubject,
      statistics: {
        ...exportData.personalData.statistics,
        totalAttachments: attachments.length,
        totalUserUploads: userUploads.length,
        downloadedFiles: downloadedFiles.length,
      },
      format: "GDPR DSAR Export",
      files: [
        "data.json",
        "README.md",
        "manifest.json",
        "signature.txt",
        ...downloadedFiles.map((f) => f.path),
      ],
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        messageId: a.messageId,
        conversationId: a.conversationId,
        type: a.type,
        size: a.size,
        included: included.has(a.url),
      })),
      uploads: userUploads.map((u) => ({
        id: u.id,
        originalName: u.originalName,
        folder: u.folder,
        included: included.has(u.id),
      })),
    };

    const readme = this.generateExportReadme(
      exportData,
      requestId,
      attachments.length,
      downloadedFiles.filter((f) => f.path.startsWith("attachments/")).length,
    );
    // Sign the data (HMAC-SHA256 of data.json content)
    const signature = this.signExportData(dataJson);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hay-privacy-export-"));
    try {
      const zipPath = path.join(dir, "export.zip");
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver.default("zip", { zlib: { level: 9 } });
        output.on("close", () => resolve());
        output.on("error", reject);
        archive.on("error", reject);
        archive.pipe(output);
        archive.append(dataJson, { name: "data.json" });
        archive.append(readme, { name: "README.md" });
        archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
        archive.append(signature, { name: "signature.txt" });
        for (const file of downloadedFiles) archive.append(file.buffer, { name: file.path });
        void archive.finalize();
      });
      return { buffer: await fs.readFile(zipPath), signature };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * A stored upload's bytes, or null when it is missing or belongs to another
   * organization. A staff user's own uploads may sit in any of their organizations.
   */
  private async readStoredFile(
    uploadId: string,
    organizationId: string,
    anyOrganization = false,
  ): Promise<Buffer | null> {
    try {
      const { buffer, upload } = await storageService.download(uploadId);
      if (!anyOrganization && upload.organizationId !== organizationId) return null;
      return buffer;
    } catch (err) {
      logger.debug({ uploadId, error: err }, "Stored file not available for export");
      return null;
    }
  }

  /**
   * Generate README.md for the export package
   */
  private generateExportReadme(
    exportData: ExportPackageData,
    requestId: string,
    totalAttachments: number = 0,
    downloadedAttachments: number = 0,
  ): string {
    const stats = exportData.personalData.statistics;
    const exportDate = new Date(exportData.exportDate).toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "long",
    });

    // Detect if this is a user or customer export
    const isCustomerExport = !!exportData.dataSubject.customerId;
    const subjectId = isCustomerExport
      ? exportData.dataSubject.customerId
      : exportData.dataSubject.userId;
    const subjectType = isCustomerExport ? "Customer" : "User";

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

    // Build data sections based on what's included
    let dataIncludedSections = "";

    if (isCustomerExport) {
      dataIncludedSections = `### Profile Information
Your customer profile data including:
- Email address
- Phone number
- Name
- Any custom metadata

### Conversations
${stats.totalConversations || 0} conversation(s) containing:
- ${stats.totalMessages || 0} message(s)
- Timestamps and metadata
- Message content and direction
${attachmentSection}### Embeddings
${stats.totalEmbeddings || 0} embedding(s):
- Vectorized representations of your message content
- Used for AI-powered search and assistance`;
    } else {
      const orgInfo =
        (stats.totalAuditLogs ?? 0) > 0
          ? "Organization membership and role information"
          : "No organization membership";
      dataIncludedSections = `### Profile Information
Your user profile data including:
- Email address
- First and last name
- Account creation date
- Last login information
- Role and status

### Organization
${orgInfo}

### Audit Logs
${stats.totalAuditLogs || 0} audit log(s):
- Actions performed on your account
- IP addresses and timestamps
- Changes to your data

### Documents
${stats.totalDocuments || 0} document(s):
- Documents you created or updated
- Metadata and timestamps`;
    }

    // Build data structure example
    const dataSubjectExample = isCustomerExport
      ? '"customerId": "UUID",\n    "organizationId": "UUID"'
      : '"userId": "UUID"';
    const personalDataExample = isCustomerExport
      ? '"conversations": [ ... ],\n    "embeddings": [ ... ],'
      : '"organization": { ... },\n    "auditLogs": [ ... ],\n    "documents": [ ... ],';
    const supportContact = isCustomerExport
      ? "the organization through their support channels"
      : "support through the appropriate channels";

    return `# GDPR Data Export

## Export Information

- **Export ID:** ${requestId}
- **Export Date:** ${exportDate}
- **${subjectType} ID:** ${subjectId}
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

${dataIncludedSections}

## Data Structure

The \`data.json\` file contains:

\`\`\`json
{
  "exportDate": "ISO 8601 timestamp",
  "exportVersion": "2.0",
  "dataSubject": {
    ${dataSubjectExample}
  },
  "personalData": {
    "profile": { ... },
    ${personalDataExample}
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
please contact ${supportContact}.

---

*This export was generated automatically by the Hay Platform DSAR system.*
`;
  }

  /**
   * Sign export data using HMAC-SHA256
   */
  private signExportData(data: string): string {
    const hmac = crypto.createHmac("sha256", deriveServiceKey("hay:privacy-export:v1"));
    hmac.update(data);
    return hmac.digest("hex");
  }

  /**
   * Erase a customer (GDPR Article 17): media files and embeddings are deleted,
   * their messages and every conversation-scoped record that quotes them are
   * deleted, the conversations are kept only as anonymous analytics rows (like
   * retention does) and the customer record is deleted.
   */
  private async executeCustomerDeletion(customerId: string, organizationId: string): Promise<void> {
    const conversations: Array<{ id: string }> = await AppDataSource.query(
      `SELECT id FROM conversations WHERE customer_id = $1 AND organization_id = $2`,
      [customerId, organizationId],
    );
    const conversationIds = conversations.map((c) => c.id);

    // Media files can't be restored, so they go first, outside the transaction;
    // failures are logged and never block the erasure.
    const mediaResult = await deleteConversationMedia({
      organizationId,
      conversationIds,
      customerId,
    });
    logger.debug(
      { customerId, deleted: mediaResult.deleted, failed: mediaResult.failed },
      "Customer media deletion completed",
    );

    await AppDataSource.transaction(async (manager) => {
      const customerRepository = manager.getRepository(Customer);
      const customer = await customerRepository.findOne({
        where: { id: customerId, organization_id: organizationId },
      });
      if (!customer) {
        throw new Error("Customer not found");
      }

      await this.eraseTestData(manager, organizationId, conversationIds, customer);
      await anonymizeConversations(manager, organizationId, conversationIds, {
        title: "[deleted]",
        deleteInsightIssues: true,
      });

      // Merge dismissals cascade with the customer row.
      await customerRepository.delete({ id: customerId, organization_id: organizationId });
      await recordErasure(manager, {
        subjectType: "customer",
        subjectId: customerId,
        organizationId,
      });

      logger.debug(
        { customerId, organizationId, conversationsAffected: conversationIds.length },
        "Customer data deleted",
      );
    });
  }

  /**
   * Simulation data has no customer link: transcripts, test cases and run seeds
   * are found by the conversations and messages they came from, and by the
   * customer's email or phone appearing in their text.
   */
  private async eraseTestData(
    manager: EntityManager,
    organizationId: string,
    conversationIds: string[],
    customer: Customer,
  ): Promise<void> {
    const { sourceRefs, needles } = await this.testDataMatchers(manager, conversationIds, customer);
    const params = [organizationId, needles];

    await manager.query(
      `DELETE FROM test_transcripts
       WHERE organization_id = $1 AND ${TEXT_MATCHES("turns::text || COALESCE(title, '')")}`,
      params,
    );
    await manager.query(
      `DELETE FROM test_cases
       WHERE organization_id = $1
         AND (${SOURCE_REF_MATCHES} OR ${TEXT_MATCHES("seed::text || title || expectations::text")})`,
      [...params, sourceRefs],
    );
    // Run items stay for the run's totals; one not finished yet can't run without its seed.
    await manager.query(
      `UPDATE simulation_run_items
       SET seed = '[]'::jsonb, expectations = NULL, verdict = NULL, source_ref = NULL, error = NULL,
           status = CASE WHEN status IN ('pending', 'running') THEN 'failed' ELSE status END,
           updated_at = now()
       WHERE organization_id = $1
         AND (conversation_id = ANY($4::uuid[]) OR ${SOURCE_REF_MATCHES} OR ${TEXT_MATCHES("seed::text")})`,
      [...params, sourceRefs, conversationIds],
    );
  }

  private async testDataMatchers(
    manager: EntityManager,
    conversationIds: string[],
    customer: Customer,
  ): Promise<{ sourceRefs: string[]; needles: string[] }> {
    const messages: Array<{ id: string }> = await manager.query(
      `SELECT id FROM messages WHERE conversation_id = ANY($1::uuid[])`,
      [conversationIds],
    );
    return {
      sourceRefs: [...conversationIds, ...messages.map((message) => message.id)],
      needles: [customer.email, customer.phone]
        .filter((value): value is string => !!value && value.length >= MIN_IDENTITY_NEEDLE_LENGTH)
        .map((value) => value.toLowerCase()),
    };
  }

  /** Records outside the conversation itself that quote or concern the customer. */
  private async collectLinkedCustomerRecords(
    organizationId: string,
    conversationIds: string[],
    customer: Customer,
  ): Promise<Record<string, unknown[]>> {
    const { sourceRefs, needles } = await this.testDataMatchers(
      AppDataSource.manager,
      conversationIds,
      customer,
    );
    const query = (sql: string, params: unknown[]): Promise<unknown[]> =>
      AppDataSource.query(sql, params);
    const inConversations = [organizationId, conversationIds];
    const matchers = [organizationId, needles, sourceRefs];

    // Who at the organization decided or answered is staff data and stays out.
    const [
      teamQuestions,
      pendingActions,
      actionLog,
      disputes,
      uploads,
      consentRecords,
      testTranscripts,
      testCases,
      simulationItems,
    ] = await Promise.all([
      query(
        `SELECT question, customer_message AS "customerMessage", answer, status,
                asked_at AS "askedAt", answered_at AS "answeredAt"
         FROM team_questions WHERE organization_id = $1 AND conversation_id = ANY($2::uuid[])`,
        inConversations,
      ),
      query(
        `SELECT tool_name AS "toolName", category, args, status, created_at AS "createdAt"
         FROM pending_actions WHERE organization_id = $1 AND conversation_id = ANY($2::uuid[])`,
        inConversations,
      ),
      query(
        `SELECT tool_name AS "toolName", category, args, outcome, created_at AS "createdAt"
         FROM action_log WHERE organization_id = $1 AND conversation_id = ANY($2::uuid[])`,
        inConversations,
      ),
      query(
        `SELECT d.status, d.amount, d.currency, d.reason, d.order_label AS "orderLabel",
                d.initiated_at AS "initiatedAt"
         FROM disputes d
         WHERE d.organization_id = $1 AND d.order_key IN (
           SELECT l.order_key FROM order_conversation_links l
           WHERE l.organization_id = $1 AND l.conversation_id = ANY($2::uuid[]))`,
        inConversations,
      ),
      query(
        `SELECT id, original_name AS "originalName", mime_type AS "mimeType", size,
                created_at AS "createdAt"
         FROM uploads WHERE organization_id = $1 AND customer_id = $2`,
        [organizationId, customer.id],
      ),
      query(
        `SELECT conversation_id AS "conversationId", action, mode, created_at AS "createdAt"
         FROM webchat_consent_events
         WHERE organization_id = $1 AND conversation_id = ANY($2::uuid[])`,
        inConversations,
      ),
      query(
        `SELECT source, title, turns, started_at AS "startedAt"
         FROM test_transcripts
         WHERE organization_id = $1 AND ${TEXT_MATCHES("turns::text || COALESCE(title, '')")}`,
        [organizationId, needles],
      ),
      query(
        `SELECT title, seed, created_at AS "createdAt"
         FROM test_cases
         WHERE organization_id = $1
           AND (${SOURCE_REF_MATCHES} OR ${TEXT_MATCHES("seed::text || title || expectations::text")})`,
        matchers,
      ),
      query(
        `SELECT seed, created_at AS "createdAt"
         FROM simulation_run_items
         WHERE organization_id = $1
           AND (conversation_id = ANY($4::uuid[]) OR ${SOURCE_REF_MATCHES} OR ${TEXT_MATCHES("seed::text")})`,
        [...matchers, conversationIds],
      ),
    ]);

    return {
      teamQuestions,
      pendingActions,
      actionLog,
      disputes,
      uploads,
      consentRecords,
      testTranscripts,
      testCases,
      simulationItems,
    };
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

        // Expand compressed IPv6 addresses (e.g., fe80::1 -> fe80:0000:0000:0000:0000:0000:0000:0001)
        // For anonymization, we only keep the first 3 groups (48 bits)

        // Split by :: to handle compression
        if (ip.includes("::")) {
          const [left] = ip.split("::");
          const leftParts = left ? left.split(":") : [];

          // Keep only the first 3 hextets from the left side
          const firstHextet = leftParts[0] || "0000";
          const secondHextet = leftParts[1] || "0000";
          const thirdHextet = leftParts[2] || "0000";

          return `${firstHextet}:${secondHextet}:${thirdHextet}::`;
        }

        // No compression - just take first 3 groups
        const parts = ip.split(":");
        const firstHextet = parts[0] || "0000";
        const secondHextet = parts[1] || "0000";
        const thirdHextet = parts[2] || "0000";

        return `${firstHextet}:${secondHextet}:${thirdHextet}::`;
      } catch (error) {
        // Safe fallback for any parsing errors
        logger.debug({ ip, error }, "Failed to anonymize IPv6 address, using fallback");
        return "0000:0000:0000::";
      }
    } else {
      // IPv4 handling - keep first 16 bits (class B network)
      const parts = ip.split(".");

      // Validate IPv4 format
      if (parts.length !== 4) {
        logger.debug({ ip }, "Invalid IPv4 address format, using fallback");
        return "0.0.0.0";
      }

      // Validate each octet is a number
      const octets = parts.map((p) => parseInt(p, 10));
      if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
        logger.debug({ ip }, "Invalid IPv4 octet values, using fallback");
        return "0.0.0.0";
      }

      return `${octets[0]}.${octets[1]}.0.0`;
    }
  }

  /**
   * Recursively anonymize PII in JSON objects and arrays
   */
  private anonymizeJsonPii(obj: unknown): unknown {
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

    const anonymized: Record<string, unknown> = { ...(obj as Record<string, unknown>) };

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
   * Daily: delete export ZIPs past their expiry (scheduled-jobs.registry).
   * A ZIP downloaded the allowed number of times is deleted right away.
   */
  async cleanupExpiredExports(now = new Date()): Promise<number> {
    const requests = await AppDataSource.getRepository(PrivacyRequest)
      .createQueryBuilder("request")
      .where("request.type = 'export'")
      .andWhere("request.metadata ->> 'uploadId' IS NOT NULL")
      .andWhere(
        "(request.metadata ->> 'exportExpiresAt' IS NULL OR " +
          "(request.metadata ->> 'exportExpiresAt')::timestamptz <= :now)",
        { now },
      )
      .getMany();
    for (const request of requests) await this.deleteExportFile(request);
    logger.info({ deleted: requests.length }, "Expired privacy exports cleaned up");
    return requests.length;
  }

  /**
   * Requeue privacy jobs whose server died mid-run; after MAX_JOB_ATTEMPTS the
   * job and its request are failed instead.
   */
  async requeueStaleJobs(now = new Date()): Promise<{ requeued: number; failed: number }> {
    const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS);
    const [rows]: [Array<{ status: string; request_id: string | null }>, number] =
      await AppDataSource.query(
        `UPDATE jobs
         SET status = CASE WHEN COALESCE((data->>'attempts')::int, 0) + 1 >= $3
                           THEN 'failed'::jobs_status_enum ELSE 'queued'::jobs_status_enum END,
             data = jsonb_set(data, '{attempts}', to_jsonb(COALESCE((data->>'attempts')::int, 0) + 1)),
             updated_at = now()
         WHERE status = 'processing' AND data->>'type' = ANY($1::text[]) AND updated_at < $2
         RETURNING status, data->>'requestId' AS request_id`,
        [PRIVACY_JOB_TYPES, cutoff, MAX_JOB_ATTEMPTS],
      );
    const failedRequestIds = rows
      .filter((row) => row.status === "failed" && row.request_id)
      .map((row) => row.request_id as string);
    if (failedRequestIds.length > 0) {
      await AppDataSource.query(
        `UPDATE privacy_requests
         SET status = 'failed', error_message = 'Processing did not finish', completed_at = now()
         WHERE id = ANY($1::uuid[]) AND status = 'processing'`,
        [failedRequestIds],
      );
    }
    const result = {
      requeued: rows.length - failedRequestIds.length,
      failed: failedRequestIds.length,
    };
    if (rows.length > 0) logger.warn(result, "Stale privacy jobs handled");
    return result;
  }

  /**
   * Daily: privacy requests older than PRIVACY_REQUEST_RETENTION_DAYS keep no
   * contact details (email hashed, IP, user agent and identifier dropped).
   */
  async anonymizeExpiredRequests(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PRIVACY_REQUEST_RETENTION_DAYS * DAY_MS);
    const [rows]: [Array<{ id: string }>, number] = await AppDataSource.query(
      `UPDATE privacy_requests
       SET email = 'erased:' || encode(sha256(convert_to(lower(email), 'UTF8')), 'hex'),
           identifier_value = NULL, ip_address = NULL, user_agent = NULL,
           download_ip_address = NULL, verification_token_hash = NULL
       WHERE created_at < $1 AND email NOT LIKE 'erased:%'
         AND status NOT IN ('verified', 'processing')
       RETURNING id`,
      [cutoff],
    );
    // Privacy jobs created before jobs carried only the request id named the
    // requester and kept the download token in their result.
    await AppDataSource.query(
      `UPDATE jobs
       SET title = 'Privacy data request', data = jsonb_build_object('requestId', data->'requestId'),
           result = NULL
       WHERE id IN (SELECT job_id FROM privacy_requests WHERE job_id IS NOT NULL)
         AND (title LIKE '%Data Export for %' OR title LIKE '%Data Deletion for %')`,
    );
    return rows.length;
  }
}

/** A file name safe inside a ZIP on any OS. */
function safeFileName(name: string): string {
  const cleaned = (name || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 80);
  return cleaned || "file";
}

// Export singleton instance
export const privacyService = new PrivacyService();
