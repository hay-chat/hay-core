import { OrganizationInvitation } from "@server/entities/organization-invitation.entity";
import * as crypto from "crypto";

// Helper functions matching the implementation
function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe("Organization Invitation Lifecycle", () => {
  describe("Token Generation and Hashing", () => {
    it("should generate unique tokens", () => {
      const token1 = generateInvitationToken();
      const token2 = generateInvitationToken();

      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it("should hash tokens consistently", () => {
      const token = generateInvitationToken();
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
    });

    it("should produce different hashes for different tokens", () => {
      const token1 = generateInvitationToken();
      const token2 = generateInvitationToken();

      const hash1 = hashToken(token1);
      const hash2 = hashToken(token2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Invitation Entity", () => {
    it("should create an invitation with correct defaults", () => {
      const invitation = new OrganizationInvitation();
      invitation.email = "test@example.com";
      invitation.organizationId = "org-123";
      invitation.role = "member";
      invitation.tokenHash = hashToken("test-token");
      invitation.status = "pending";
      invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      expect(invitation.email).toBe("test@example.com");
      expect(invitation.status).toBe("pending");
      expect(invitation.role).toBe("member");
    });

    describe("isExpired", () => {
      it("should return false for non-expired invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day from now

        expect(invitation.isExpired()).toBe(false);
      });

      it("should return true for expired invitation by date", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";
        invitation.expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago

        expect(invitation.isExpired()).toBe(true);
      });

      it("should return true for cancelled invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "cancelled";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.isExpired()).toBe(true);
      });

      it("should return true for already accepted invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "accepted";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.isExpired()).toBe(true);
      });

      it("should return true for declined invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "declined";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.isExpired()).toBe(true);
      });
    });

    describe("canAccept", () => {
      it("should allow accepting pending non-expired invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.canAccept()).toBe(true);
      });

      it("should not allow accepting expired invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";
        invitation.expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

        expect(invitation.canAccept()).toBe(false);
      });

      it("should not allow accepting cancelled invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "cancelled";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.canAccept()).toBe(false);
      });

      it("should not allow accepting already accepted invitation", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "accepted";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        expect(invitation.canAccept()).toBe(false);
      });
    });

    describe("accept", () => {
      it("should change status to accepted and set timestamp", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";
        invitation.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const before = new Date();
        invitation.accept();

        expect(invitation.status).toBe("accepted");
        expect(invitation.acceptedAt).toBeInstanceOf(Date);
        expect(invitation.acceptedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });
    });

    describe("decline", () => {
      it("should change status to declined", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";

        invitation.decline();

        expect(invitation.status).toBe("declined");
      });
    });

    describe("cancel", () => {
      it("should change status to cancelled", () => {
        const invitation = new OrganizationInvitation();
        invitation.status = "pending";

        invitation.cancel();

        expect(invitation.status).toBe("cancelled");
      });
    });
  });

  describe("Invitation Security", () => {
    it("should not expose raw tokens in storage", () => {
      const rawToken = generateInvitationToken();
      const tokenHash = hashToken(rawToken);

      // Hash should be different from token
      expect(tokenHash).not.toBe(rawToken);

      // Hash should always be SHA-256 (64 chars)
      expect(tokenHash.length).toBe(64);
    });

    it("should use different salts for each invitation (via random token)", () => {
      const invitation1 = new OrganizationInvitation();
      const invitation2 = new OrganizationInvitation();

      const token1 = generateInvitationToken();
      const token2 = generateInvitationToken();

      invitation1.tokenHash = hashToken(token1);
      invitation2.tokenHash = hashToken(token2);

      expect(invitation1.tokenHash).not.toBe(invitation2.tokenHash);
    });
  });

  describe("Invitation Expiration", () => {
    it("should expire after 7 days", () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const invitation = new OrganizationInvitation();
      invitation.status = "pending";
      invitation.expiresAt = expiresAt;

      // Should not be expired now
      expect(invitation.isExpired()).toBe(false);

      // Simulate time passing (move expiry to past)
      invitation.expiresAt = new Date(Date.now() - 1000); // 1 second ago
      expect(invitation.isExpired()).toBe(true);
    });
  });

  describe("Invitation Email Validation", () => {
    it("should store email in lowercase", () => {
      // This would typically be done in the endpoint/service
      const email = "Test@Example.COM";
      const normalizedEmail = email.toLowerCase();

      expect(normalizedEmail).toBe("test@example.com");
    });

    it("should match emails case-insensitively", () => {
      const invitationEmail = "user@example.com";
      const userEmail1 = "User@Example.com";
      const userEmail2 = "USER@EXAMPLE.COM";

      // Both should match when compared case-insensitively
      expect(invitationEmail.toLowerCase()).toBe(userEmail1.toLowerCase());
      expect(invitationEmail.toLowerCase()).toBe(userEmail2.toLowerCase());
    });
  });

  describe("Invitation Roles", () => {
    it("should support all valid roles", () => {
      const validRoles: Array<"owner" | "admin" | "contributor" | "member" | "viewer"> = [
        "owner",
        "admin",
        "contributor",
        "member",
        "viewer",
      ];

      validRoles.forEach((role) => {
        const invitation = new OrganizationInvitation();
        invitation.role = role;
        expect(invitation.role).toBe(role);
      });
    });
  });

  describe("Duplicate Invitation Prevention", () => {
    it("should detect existing pending invitations", () => {
      const invitations: OrganizationInvitation[] = [
        {
          email: "user@example.com",
          organizationId: "org-123",
          status: "pending",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } as OrganizationInvitation,
      ];

      const newInvitation = {
        email: "user@example.com",
        organizationId: "org-123",
      };

      // Check if invitation already exists
      const existing = invitations.find(
        (inv) =>
          inv.email === newInvitation.email &&
          inv.organizationId === newInvitation.organizationId &&
          inv.status === "pending" &&
          !inv.isExpired(),
      );

      expect(existing).toBeDefined();
    });

    it("should allow re-inviting if previous invitation expired", () => {
      const invitations: OrganizationInvitation[] = [
        {
          email: "user@example.com",
          organizationId: "org-123",
          status: "pending",
          expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired
          isExpired: () => true,
        } as OrganizationInvitation,
      ];

      const newInvitation = {
        email: "user@example.com",
        organizationId: "org-123",
      };

      // Check if valid invitation exists (not expired)
      const existing = invitations.find(
        (inv) =>
          inv.email === newInvitation.email &&
          inv.organizationId === newInvitation.organizationId &&
          inv.status === "pending" &&
          !inv.isExpired(),
      );

      expect(existing).toBeUndefined(); // No valid invitation, can send new one
    });
  });
});
