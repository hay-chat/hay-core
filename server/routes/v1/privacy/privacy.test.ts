import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import { AuditLog } from "@server/entities/audit-log.entity";
import { Organization } from "@server/entities/organization.entity";
import { privacyService } from "@server/services/privacy.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import { redisService } from "@server/services/redis.service";
import { hashPassword } from "@server/lib/auth/utils/hashing";

describe("Privacy DSAR Integration Tests", () => {
  let testUser: User;
  let testOrg: Organization;
  const testEmail = "privacy-test@example.com";
  const testIp = "192.168.1.100";
  const testUserAgent = "Mozilla/5.0 (Test Browser)";

  beforeAll(async () => {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Initialize Redis
    if (!redisService.isConnected()) {
      await redisService.initialize();
    }
  });

  afterAll(async () => {
    // Clean up database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }

    // Clean up Redis
    await redisService.shutdown();
  });

  beforeEach(async () => {
    // Clean up test data
    const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
    const auditLogRepo = AppDataSource.getRepository(AuditLog);
    const userRepo = AppDataSource.getRepository(User);
    const orgRepo = AppDataSource.getRepository(Organization);

    await privacyRequestRepo.delete({ email: testEmail });
    await auditLogRepo.delete({ userId: testUser?.id });
    await userRepo.delete({ email: testEmail });
    await orgRepo.delete({ name: "Privacy Test Org" });

    // Reset rate limits
    await rateLimitService.resetRateLimit(testEmail, "email");
    await rateLimitService.resetRateLimit(testIp, "ip");
    await rateLimitService.resetRateLimit(`${testIp}:${testEmail}`, "combined");

    // Create test organization
    const orgRepository = AppDataSource.getRepository(Organization);
    testOrg = orgRepository.create({
      name: "Privacy Test Org",
      slug: "privacy-test-org",
      isActive: true,
      limits: {
        maxUsers: 10,
        maxDocuments: 100,
        maxApiKeys: 10,
        maxJobs: 50,
        maxStorageGb: 1,
      },
    });
    await orgRepository.save(testOrg);

    // Create test user
    const userRepository = AppDataSource.getRepository(User);
    const hashedPassword = await hashPassword("TestPassword123!", "argon2");

    testUser = userRepository.create({
      email: testEmail,
      password: hashedPassword,
      firstName: "Privacy",
      lastName: "Tester",
      isActive: true,
      organizationId: testOrg.id,
      role: "member",
    });
    await userRepository.save(testUser);
  });

  describe("Data Export Flow", () => {
    it("should complete end-to-end export request", async () => {
      // Step 1: Request export
      const requestResult = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.expiresAt).toBeInstanceOf(Date);

      // Verify privacy request was created
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({
        where: { id: requestResult.requestId },
      });

      expect(request).toBeDefined();
      expect(request?.email).toBe(testEmail);
      expect(request?.type).toBe("export");
      expect(request?.status).toBe("pending_verification");
      expect(request?.verificationTokenHash).toBeDefined();
      expect(request?.ipAddress).toBe(testIp);
      expect(request?.userAgent).toBe(testUserAgent);

      // Verify audit log
      const auditLogRepo = AppDataSource.getRepository(AuditLog);
      const auditLog = await auditLogRepo.findOne({
        where: {
          action: "privacy.export.request",
          userId: testUser.id,
        },
      });

      expect(auditLog).toBeDefined();
      expect(auditLog?.resource).toBe("privacy_request");
    }, 10000);

    it("should enforce rate limiting on export requests", async () => {
      // Make requests up to the limit
      for (let i = 0; i < 2; i++) {
        await privacyService.requestExport(testEmail, testIp, testUserAgent);
      }

      // Next request should fail
      await expect(
        privacyService.requestExport(testEmail, testIp, testUserAgent),
      ).rejects.toThrow();
    }, 15000);

    it("should collect complete user data for export", async () => {
      const exportData = await (privacyService as any).collectUserData(testUser.id, testEmail);

      expect(exportData).toBeDefined();
      expect(exportData.exportDate).toBeDefined();
      expect(exportData.dataSubject.email).toBe(testEmail);
      expect(exportData.dataSubject.userId).toBe(testUser.id);

      expect(exportData.personalData).toBeDefined();
      expect(exportData.personalData.profile).toBeDefined();
      expect(exportData.personalData.profile.email).toBe(testEmail);
      expect(exportData.personalData.profile.firstName).toBe("Privacy");
      expect(exportData.personalData.profile.lastName).toBe("Tester");

      expect(exportData.personalData.organization).toBeDefined();
      expect(exportData.personalData.organization.name).toBe("Privacy Test Org");

      expect(exportData.personalData.apiKeys).toBeInstanceOf(Array);
      expect(exportData.personalData.auditLogs).toBeInstanceOf(Array);
      expect(exportData.personalData.documents).toBeInstanceOf(Array);
    }, 10000);
  });

  describe("Data Deletion Flow", () => {
    it("should complete end-to-end deletion request", async () => {
      // Step 1: Request deletion
      const requestResult = await privacyService.requestDeletion(testEmail, testIp, testUserAgent);

      expect(requestResult.requestId).toBeDefined();
      expect(requestResult.expiresAt).toBeInstanceOf(Date);

      // Verify privacy request was created
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({
        where: { id: requestResult.requestId },
      });

      expect(request).toBeDefined();
      expect(request?.email).toBe(testEmail);
      expect(request?.type).toBe("deletion");
      expect(request?.status).toBe("pending_verification");
      expect(request?.userId).toBe(testUser.id);

      // Verify audit log
      const auditLogRepo = AppDataSource.getRepository(AuditLog);
      const auditLog = await auditLogRepo.findOne({
        where: {
          action: "privacy.deletion.request",
          userId: testUser.id,
        },
      });

      expect(auditLog).toBeDefined();
    }, 10000);

    it("should properly anonymize user data on deletion", async () => {
      // Execute deletion
      await (privacyService as any).executeDataDeletion(testUser.id, testEmail);

      // Verify user was soft deleted
      const userRepo = AppDataSource.getRepository(User);
      const deletedUser = await userRepo.findOne({
        where: { id: testUser.id },
      });

      expect(deletedUser).toBeDefined();
      expect(deletedUser?.deletedAt).toBeDefined();
      expect(deletedUser?.isActive).toBe(false);
      expect(deletedUser?.email).toContain("deleted-");
      expect(deletedUser?.email).toContain("@deleted.local");
      expect(deletedUser?.firstName).toBeUndefined();
      expect(deletedUser?.lastName).toBeUndefined();

      // Verify audit logs were anonymized
      const auditLogRepo = AppDataSource.getRepository(AuditLog);
      const anonymizedLogs = await auditLogRepo.find({
        where: { userId: "deleted-user" },
      });

      expect(anonymizedLogs.length).toBeGreaterThan(0);
      anonymizedLogs.forEach((log) => {
        expect(log.ipAddress).toBe("0.0.0.0");
        expect(log.userAgent).toBe("deleted");
      });
    }, 10000);

    it("should fail deletion request for non-existent user", async () => {
      await expect(
        privacyService.requestDeletion("nonexistent@example.com", testIp, testUserAgent),
      ).rejects.toThrow("No account found with this email address");
    });
  });

  describe("Request Status Tracking", () => {
    it("should track request status correctly", async () => {
      const requestResult = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      const status = await privacyService.getStatus(requestResult.requestId);

      expect(status.id).toBe(requestResult.requestId);
      expect(status.type).toBe("export");
      expect(status.status).toBe("pending_verification");
      expect(status.createdAt).toBeInstanceOf(Date);
      expect(status.downloadAvailable).toBe(false);
    }, 10000);

    it("should throw error for non-existent request", async () => {
      await expect(
        privacyService.getStatus("00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow("Privacy request not found");
    });
  });

  describe("Security & Verification", () => {
    it("should expire verification tokens after 24 hours", async () => {
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);

      // Create expired request manually
      const expiredRequest = privacyRequestRepo.create({
        email: testEmail,
        userId: testUser.id,
        type: "export",
        status: "pending_verification",
        verificationTokenHash: "dummy-hash",
        verificationExpiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        ipAddress: testIp,
      });
      await privacyRequestRepo.save(expiredRequest);

      expect(expiredRequest.isExpired()).toBe(true);
      expect(expiredRequest.canVerify()).toBe(false);
    });

    it("should store proper audit trail for all actions", async () => {
      await privacyService.requestExport(testEmail, testIp, testUserAgent);

      const auditLogRepo = AppDataSource.getRepository(AuditLog);
      const logs = await auditLogRepo.find({
        where: { userId: testUser.id },
        order: { createdAt: "DESC" },
      });

      expect(logs.length).toBeGreaterThan(0);

      const exportRequestLog = logs.find((log) => log.action === "privacy.export.request");
      expect(exportRequestLog).toBeDefined();
      expect(exportRequestLog?.resource).toBe("privacy_request");
      expect(exportRequestLog?.status).toBe("success");
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce IP-based rate limiting", async () => {
      const ipLimit = await rateLimitService.checkIpRateLimit(testIp, 3, 3600);
      expect(ipLimit.limited).toBe(false);
      expect(ipLimit.remaining).toBe(2); // First request consumed one

      // Make more requests
      await rateLimitService.checkIpRateLimit(testIp, 3, 3600);
      await rateLimitService.checkIpRateLimit(testIp, 3, 3600);

      // Should now be limited
      const limitedResult = await rateLimitService.checkIpRateLimit(testIp, 3, 3600);
      expect(limitedResult.limited).toBe(true);
      expect(limitedResult.remaining).toBe(0);
    });

    it("should enforce email-based rate limiting", async () => {
      const emailLimit = await rateLimitService.checkEmailRateLimit(testEmail, 2, 86400);
      expect(emailLimit.limited).toBe(false);

      await rateLimitService.checkEmailRateLimit(testEmail, 2, 86400);

      const limitedResult = await rateLimitService.checkEmailRateLimit(testEmail, 2, 86400);
      expect(limitedResult.limited).toBe(true);
    });

    it("should reset rate limits correctly", async () => {
      // Consume limit
      await rateLimitService.checkEmailRateLimit(testEmail, 1, 3600);

      const limitedResult = await rateLimitService.checkEmailRateLimit(testEmail, 1, 3600);
      expect(limitedResult.limited).toBe(true);

      // Reset
      await rateLimitService.resetRateLimit(testEmail, "email");

      // Should work again
      const resetResult = await rateLimitService.checkEmailRateLimit(testEmail, 1, 3600);
      expect(resetResult.limited).toBe(false);
    });
  });
});
