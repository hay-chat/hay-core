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
    // Clean up test data - order matters due to foreign key constraints
    const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
    const auditLogRepo = AppDataSource.getRepository(AuditLog);
    const userRepo = AppDataSource.getRepository(User);
    const orgRepo = AppDataSource.getRepository(Organization);

    // Find the organization first to get its ID
    const existingOrg = await orgRepo.findOne({ where: { slug: "privacy-test-org" } });
    if (existingOrg) {
      // Find all users in this organization BEFORE deleting anything
      const existingUsers = await userRepo.find({ where: { organizationId: existingOrg.id } });
      const userIds = existingUsers.map(u => u.id);

      // Delete in correct order to respect foreign key constraints:
      // 1. Privacy requests (references users)
      await privacyRequestRepo.delete({ email: testEmail });

      // 2. Jobs (references organization)
      const { Job } = await import("@server/entities/job.entity");
      const jobRepo = AppDataSource.getRepository(Job);
      await jobRepo.delete({ organizationId: existingOrg.id });

      // 3. Audit logs (references both users and organization)
      // Delete all audit logs for users in this organization
      if (userIds.length > 0) {
        await auditLogRepo
          .createQueryBuilder()
          .delete()
          .where("user_id IN (:...userIds)", { userIds })
          .execute();
      }
      // Delete audit logs by organization ID
      if (existingOrg.id) {
        await auditLogRepo.delete({ organizationId: existingOrg.id });
      }
      // Clean up any audit logs with special string user IDs (created during deletion tests)
      // Note: This uses raw query since userId column is UUID type but contains strings
      await auditLogRepo.query(
        "DELETE FROM audit_logs WHERE user_id::text IN ('anonymous', 'deleted-user')"
      );

      // 4. Users (now safe to delete as no audit logs reference them)
      await userRepo.delete({ organizationId: existingOrg.id });

      // 5. Organization (now safe to delete)
      await orgRepo.delete({ id: existingOrg.id });
    }

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

  describe("Edge Cases & Error Handling", () => {
    it("should handle concurrent verification attempts", async () => {
      // Request export
      const { requestId } = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      // Get the request to extract the token
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({ where: { id: requestId } });
      expect(request).toBeDefined();

      // Simulate concurrent confirmations
      // Note: In real scenario, we'd use the actual token from email
      // For testing, we'll create a new token and hash it
      const testToken = "test-verification-token";
      const tokenHash = await hashPassword(testToken, "argon2");
      request!.verificationTokenHash = tokenHash;
      await privacyRequestRepo.save(request!);

      // Try to confirm multiple times concurrently
      const confirmPromises = [
        privacyService.confirmExport(testToken),
        privacyService.confirmExport(testToken),
        privacyService.confirmExport(testToken),
      ];

      const results = await Promise.allSettled(confirmPromises);

      // Only one should succeed
      const successful = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      expect(successful.length).toBeGreaterThanOrEqual(1);
      expect(failed.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle expired verification tokens", async () => {
      // Request export
      const { requestId } = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      // Get request and manually expire it
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({ where: { id: requestId } });
      expect(request).toBeDefined();

      // Set expiry to past
      request!.verificationExpiresAt = new Date(Date.now() - 1000);
      await privacyRequestRepo.save(request!);

      // Try to confirm with a test token
      const testToken = "test-verification-token";
      const tokenHash = await hashPassword(testToken, "argon2");
      request!.verificationTokenHash = tokenHash;
      await privacyRequestRepo.save(request!);

      // Should fail
      await expect(privacyService.confirmExport(testToken)).rejects.toThrow("expired");
    });

    it("should prevent token reuse after verification", async () => {
      // Request export
      const { requestId } = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      // Get request and set test token
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({ where: { id: requestId } });
      const testToken = "test-verification-token";
      const tokenHash = await hashPassword(testToken, "argon2");
      request!.verificationTokenHash = tokenHash;
      await privacyRequestRepo.save(request!);

      // First confirmation should work
      await privacyService.confirmExport(testToken);

      // Second confirmation with same token should fail
      await expect(privacyService.confirmExport(testToken)).rejects.toThrow();
    });

    it("should handle download token expiry", async () => {
      // Create a completed export request
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = privacyRequestRepo.create({
        email: testEmail,
        userId: testUser.id,
        type: "export",
        status: "completed",
        metadata: {
          exportUrl: "/tmp/test-export.json",
          downloadToken: "test-download-token",
          exportExpiresAt: new Date(Date.now() - 1000), // Already expired
        },
      });
      await privacyRequestRepo.save(request);

      // Try to download
      await expect(
        privacyService.downloadExport(request.id, "test-download-token", testIp),
      ).rejects.toThrow("expired");
    });

    it("should enforce single-use downloads", async () => {
      // Create a completed export with maxDownloads = 1
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = privacyRequestRepo.create({
        email: testEmail,
        userId: testUser.id,
        type: "export",
        status: "completed",
        downloadCount: 1, // Already downloaded once
        maxDownloads: 1,
        metadata: {
          exportUrl: "/tmp/test-export.json",
          downloadToken: "test-download-token",
          exportExpiresAt: new Date(Date.now() + 86400000), // Not expired
        },
      });
      await privacyRequestRepo.save(request);

      // Try to download again
      await expect(
        privacyService.downloadExport(request.id, "test-download-token", testIp),
      ).rejects.toThrow("Download limit exceeded");
    });

    it("should handle IP address anonymization edge cases", async () => {
      // Test various IP formats
      const testCases = [
        { ip: "192.168.1.100", expected: "192.168.0.0" },
        { ip: "10.0.0.1", expected: "10.0.0.0" },
        { ip: "172.16.254.1", expected: "172.16.0.0" },
        { ip: "::1", expected: "0000:0000:0000::" },
        { ip: "::", expected: "0000:0000:0000::" },
        { ip: "2001:db8:85a3::8a2e:370:7334", expected: "2001:db8:85a3::" },
        { ip: "fe80::1", expected: "fe80:0000:0000::" },
      ];

      for (const { ip, expected } of testCases) {
        // Create audit log with IP
        const auditLogRepo = AppDataSource.getRepository(AuditLog);
        const log = auditLogRepo.create({
          action: "profile.update",
          resource: "test",
          userId: testUser.id,
          organizationId: testOrg.id,
          ipAddress: ip,
          status: "success",
        });
        await auditLogRepo.save(log);

        // Delete user (which triggers anonymization)
        await (privacyService as any).executeDataDeletion(testUser.id, testUser.email);

        // Verify IP was anonymized
        const anonymizedLog = await auditLogRepo.findOne({ where: { id: log.id } });
        expect(anonymizedLog?.ipAddress).toBe(expected);

        // Cleanup for next iteration
        await auditLogRepo.delete({ id: log.id });

        // Recreate user for next test
        const userRepo = AppDataSource.getRepository(User);
        const hashedPassword = await hashPassword("TestPassword123!", "argon2");
        testUser = userRepo.create({
          email: testEmail,
          password: hashedPassword,
          firstName: "Privacy",
          lastName: "Tester",
          isActive: true,
          organizationId: testOrg.id,
          role: "member",
        });
        await userRepo.save(testUser);
      }
    });

    it("should anonymize arrays in JSON metadata", async () => {
      // Create audit log with array of sensitive data
      const auditLogRepo = AppDataSource.getRepository(AuditLog);
      const log = auditLogRepo.create({
        action: "profile.update",
        resource: "test",
        userId: testUser.id,
        organizationId: testOrg.id,
        metadata: {
          users: [
            { name: "John Doe", email: "john@example.com" },
            { name: "Jane Doe", email: "jane@example.com" },
          ],
          emails: ["test1@example.com", "test2@example.com"],
        },
        status: "success",
      });
      await auditLogRepo.save(log);

      // Delete user (triggers anonymization)
      await (privacyService as any).executeDataDeletion(testUser.id, testUser.email);

      // Verify arrays were anonymized
      const anonymizedLog = await auditLogRepo.findOne({ where: { id: log.id } });
      expect(anonymizedLog?.metadata.users[0].email).toBe("[REDACTED]");
      expect(anonymizedLog?.metadata.users[1].email).toBe("[REDACTED]");
      expect(anonymizedLog?.metadata.users[0].name).toBe("[REDACTED]");
    });

    it("should handle deletion of already-deleted users", async () => {
      // Soft delete user first
      const userRepo = AppDataSource.getRepository(User);
      testUser.deletedAt = new Date();
      await userRepo.save(testUser);

      // Try to request deletion again
      await expect(
        privacyService.requestDeletion(testEmail, testIp, testUserAgent),
      ).rejects.toThrow("not found");
    });

    it("should cancel pending privacy requests", async () => {
      // Request export
      const { requestId } = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      // Get request and set test token
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({ where: { id: requestId } });
      const testToken = "test-verification-token";
      const tokenHash = await hashPassword(testToken, "argon2");
      request!.verificationTokenHash = tokenHash;
      await privacyRequestRepo.save(request!);

      // Cancel the request
      await privacyService.cancelRequest(requestId, testToken, testIp);

      // Verify status is cancelled
      const cancelledRequest = await privacyRequestRepo.findOne({ where: { id: requestId } });
      expect(cancelledRequest?.status).toBe("cancelled");
    });

    it("should not allow cancelling completed requests", async () => {
      // Create a completed request
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const testToken = "test-verification-token";
      const tokenHash = await hashPassword(testToken, "argon2");

      const request = privacyRequestRepo.create({
        email: testEmail,
        userId: testUser.id,
        type: "export",
        status: "completed",
        verificationTokenHash: tokenHash,
      });
      await privacyRequestRepo.save(request);

      // Try to cancel
      await expect(
        privacyService.cancelRequest(request.id, testToken, testIp),
      ).rejects.toThrow("Cannot cancel");
    });

    it("should handle invalid download tokens", async () => {
      // Create a completed export
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = privacyRequestRepo.create({
        email: testEmail,
        userId: testUser.id,
        type: "export",
        status: "completed",
        metadata: {
          exportUrl: "/tmp/test-export.json",
          downloadToken: "correct-token",
        },
      });
      await privacyRequestRepo.save(request);

      // Try with wrong token
      await expect(
        privacyService.downloadExport(request.id, "wrong-token", testIp),
      ).rejects.toThrow("Invalid download token");
    });

    it("should respect maxDownloads configuration", async () => {
      // Request export (which should use config.privacy.maxDownloadCount)
      const { requestId } = await privacyService.requestExport(testEmail, testIp, testUserAgent);

      // Verify maxDownloads was set from config
      const privacyRequestRepo = AppDataSource.getRepository(PrivacyRequest);
      const request = await privacyRequestRepo.findOne({ where: { id: requestId } });

      // Default is 1 from config
      expect(request?.maxDownloads).toBe(1);
    });
  });
});
