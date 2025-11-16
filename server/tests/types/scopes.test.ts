import {
  buildScope,
  matchesScope,
  hasRequiredScope,
  getDefaultScopesForRole,
  isValidScope,
  validateScopes,
  type Resource,
  type Action,
} from "@server/types/scopes";

describe("Scope System", () => {
  describe("buildScope", () => {
    it("should build a scope string from resource and action", () => {
      expect(buildScope("conversations", "read")).toBe("conversations:read");
      expect(buildScope("documents", "create")).toBe("documents:create");
      expect(buildScope("*", "*")).toBe("*:*");
    });
  });

  describe("matchesScope", () => {
    it("should match exact scopes", () => {
      expect(matchesScope("conversations:read", ["conversations:read"])).toBe(true);
      expect(matchesScope("documents:create", ["documents:create"])).toBe(true);
    });

    it("should not match different scopes", () => {
      expect(matchesScope("conversations:read", ["documents:read"])).toBe(false);
      expect(matchesScope("conversations:read", ["conversations:create"])).toBe(false);
    });

    it("should match wildcard resource", () => {
      expect(matchesScope("conversations:read", ["*:read"])).toBe(true);
      expect(matchesScope("documents:read", ["*:read"])).toBe(true);
      expect(matchesScope("agents:create", ["*:read"])).toBe(false);
    });

    it("should match wildcard action", () => {
      expect(matchesScope("conversations:read", ["conversations:*"])).toBe(true);
      expect(matchesScope("conversations:create", ["conversations:*"])).toBe(true);
      expect(matchesScope("documents:read", ["conversations:*"])).toBe(false);
    });

    it("should match full wildcard", () => {
      expect(matchesScope("conversations:read", ["*:*"])).toBe(true);
      expect(matchesScope("documents:create", ["*:*"])).toBe(true);
      expect(matchesScope("agents:delete", ["*:*"])).toBe(true);
    });
  });

  describe("hasRequiredScope", () => {
    it("should check if user has required scope with exact match", () => {
      const userScopes = ["conversations:read", "documents:create"];
      expect(hasRequiredScope("conversations", "read", userScopes)).toBe(true);
      expect(hasRequiredScope("documents", "create", userScopes)).toBe(true);
      expect(hasRequiredScope("agents", "read", userScopes)).toBe(false);
    });

    it("should check with wildcard scopes", () => {
      const userScopes = ["conversations:*", "documents:read"];
      expect(hasRequiredScope("conversations", "read", userScopes)).toBe(true);
      expect(hasRequiredScope("conversations", "create", userScopes)).toBe(true);
      expect(hasRequiredScope("documents", "read", userScopes)).toBe(true);
      expect(hasRequiredScope("documents", "create", userScopes)).toBe(false);
    });

    it("should check with full wildcard", () => {
      const userScopes = ["*:*"];
      expect(hasRequiredScope("conversations", "read", userScopes)).toBe(true);
      expect(hasRequiredScope("documents", "delete", userScopes)).toBe(true);
      expect(hasRequiredScope("agents", "execute", userScopes)).toBe(true);
    });

    it("should return false for empty scopes", () => {
      expect(hasRequiredScope("conversations", "read", [])).toBe(false);
    });
  });

  describe("getDefaultScopesForRole", () => {
    it("should return full access for owner", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(scopes).toContain("*:*");
    });

    it("should return full access for admin", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(scopes).toContain("*:*");
    });

    it("should return contributor scopes", () => {
      const scopes = getDefaultScopesForRole("contributor");
      // Should have create and update for agents/playbooks
      expect(scopes).toContain("agents:create");
      expect(scopes).toContain("playbooks:create");
      expect(scopes).toContain("conversations:*");
      // Should NOT have delete for agents/playbooks
      expect(scopes).not.toContain("agents:delete");
      expect(scopes).not.toContain("playbooks:delete");
    });

    it("should return member scopes", () => {
      const scopes = getDefaultScopesForRole("member");
      // Should have full access to conversations
      expect(scopes).toContain("conversations:*");
      // Should have read, create, update for documents (but not delete)
      expect(scopes).toContain("documents:read");
      expect(scopes).toContain("documents:create");
      expect(scopes).toContain("documents:update");
      expect(scopes).not.toContain("documents:delete");
      // Should only have read access to agents
      expect(scopes).toContain("agents:read");
      expect(scopes).not.toContain("agents:create");
    });

    it("should return viewer scopes (read-only)", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(scopes).toContain("conversations:read");
      expect(scopes).toContain("documents:read");
      expect(scopes).toContain("agents:read");
      expect(scopes).not.toContain("conversations:create");
      expect(scopes).not.toContain("documents:create");
    });
  });

  describe("isValidScope", () => {
    it("should validate correct scope formats", () => {
      expect(isValidScope("conversations:read")).toBe(true);
      expect(isValidScope("*:*")).toBe(true);
      expect(isValidScope("documents:create")).toBe(true);
    });

    it("should reject invalid scope formats", () => {
      expect(isValidScope("invalid")).toBe(false);
      expect(isValidScope("too:many:parts")).toBe(false);
      expect(isValidScope("")).toBe(false);
    });
  });

  describe("validateScopes", () => {
    it("should validate all valid scopes", () => {
      const scopes = ["conversations:read", "documents:create", "*:*"];
      const result = validateScopes(scopes);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should reject if any scope is invalid", () => {
      const scopes = ["conversations:read", "invalid", "documents:create"];
      const result = validateScopes(scopes);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should validate empty array", () => {
      const result = validateScopes([]);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("Role Hierarchy", () => {
    it("should ensure owner has more permissions than admin", () => {
      const ownerScopes = getDefaultScopesForRole("owner");
      const adminScopes = getDefaultScopesForRole("admin");

      // Both should have full access
      expect(ownerScopes).toContain("*:*");
      expect(adminScopes).toContain("*:*");
    });

    it("should ensure admin has more permissions than contributor", () => {
      const adminScopes = getDefaultScopesForRole("admin");
      const contributorScopes = getDefaultScopesForRole("contributor");

      expect(hasRequiredScope("agents", "delete", adminScopes)).toBe(true);
      expect(hasRequiredScope("agents", "delete", contributorScopes)).toBe(false);
    });

    it("should ensure contributor has more permissions than member", () => {
      const contributorScopes = getDefaultScopesForRole("contributor");
      const memberScopes = getDefaultScopesForRole("member");

      expect(hasRequiredScope("agents", "create", contributorScopes)).toBe(true);
      expect(hasRequiredScope("agents", "create", memberScopes)).toBe(false);
    });

    it("should ensure member has more permissions than viewer", () => {
      const memberScopes = getDefaultScopesForRole("member");
      const viewerScopes = getDefaultScopesForRole("viewer");

      expect(hasRequiredScope("conversations", "create", memberScopes)).toBe(true);
      expect(hasRequiredScope("conversations", "create", viewerScopes)).toBe(false);
    });
  });

  describe("Custom Permissions", () => {
    it("should allow custom permissions to override role defaults", () => {
      const roleScopes = getDefaultScopesForRole("viewer");
      const customScopes = ["conversations:create"];
      const allScopes = [...roleScopes, ...customScopes];

      // Viewer normally can't create, but with custom permission they can
      expect(hasRequiredScope("conversations", "create", allScopes)).toBe(true);
    });

    it("should combine role and custom permissions correctly", () => {
      const roleScopes = getDefaultScopesForRole("member");
      const customScopes = ["agents:create", "playbooks:create"];
      const allScopes = [...roleScopes, ...customScopes];

      // Member has conversation access from role
      expect(hasRequiredScope("conversations", "create", allScopes)).toBe(true);
      // Member gets agent creation from custom permission
      expect(hasRequiredScope("agents", "create", allScopes)).toBe(true);
    });
  });
});
