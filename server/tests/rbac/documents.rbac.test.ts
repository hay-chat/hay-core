import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";

/**
 * RBAC Tests for Documents Resource
 * Tests role-based access control for document creation, modification, and deletion
 */
describe("RBAC - Documents Resource", () => {
  describe("Document Creation (documents:create)", () => {
    it("should allow owner to create documents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(true);
    });

    it("should allow admin to create documents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(true);
    });

    it("should allow contributor to create documents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(true);
    });

    it("should allow member to create documents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(true);
    });

    it("should deny viewer from creating documents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(false);
    });

    it("should deny agent role from creating documents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("documents", "create", scopes)).toBe(false);
    });
  });

  describe("Document Reading (documents:read)", () => {
    it("should allow owner to read documents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(true);
    });

    it("should allow admin to read documents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(true);
    });

    it("should allow contributor to read documents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(true);
    });

    it("should allow member to read documents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(true);
    });

    it("should allow viewer to read documents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(true);
    });

    it("should deny agent role from reading documents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("documents", "read", scopes)).toBe(false);
    });
  });

  describe("Document Update (documents:update)", () => {
    it("should allow owner to update documents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(true);
    });

    it("should allow admin to update documents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(true);
    });

    it("should allow contributor to update documents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(true);
    });

    it("should allow member to update documents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(true);
    });

    it("should deny viewer from updating documents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(false);
    });

    it("should deny agent role from updating documents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("documents", "update", scopes)).toBe(false);
    });
  });

  describe("Document Deletion (documents:delete)", () => {
    it("should allow owner to delete documents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(true);
    });

    it("should allow admin to delete documents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(true);
    });

    it("should deny contributor from deleting documents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(false);
    });

    it("should deny member from deleting documents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(false);
    });

    it("should deny viewer from deleting documents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(false);
    });

    it("should deny agent role from deleting documents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("documents", "delete", scopes)).toBe(false);
    });
  });

  describe("Permission Escalation Prevention", () => {
    it("should prevent viewer from bypassing read-only restrictions", () => {
      const viewerScopes = getDefaultScopesForRole("viewer");

      expect(hasRequiredScope("documents", "read", viewerScopes)).toBe(true);
      expect(hasRequiredScope("documents", "create", viewerScopes)).toBe(false);
      expect(hasRequiredScope("documents", "update", viewerScopes)).toBe(false);
      expect(hasRequiredScope("documents", "delete", viewerScopes)).toBe(false);
    });

    it("should prevent agent role from having any write access to documents", () => {
      const agentScopes = getDefaultScopesForRole("agent");

      // Agent should not have document access (focused on conversations)
      expect(hasRequiredScope("documents", "create", agentScopes)).toBe(false);
      expect(hasRequiredScope("documents", "update", agentScopes)).toBe(false);
      expect(hasRequiredScope("documents", "delete", agentScopes)).toBe(false);
    });
  });

  describe("Member Permissions", () => {
    it("should allow member full CRUD except delete", () => {
      const memberScopes = getDefaultScopesForRole("member");

      expect(hasRequiredScope("documents", "read", memberScopes)).toBe(true);
      expect(hasRequiredScope("documents", "create", memberScopes)).toBe(true);
      expect(hasRequiredScope("documents", "update", memberScopes)).toBe(true);
      expect(hasRequiredScope("documents", "delete", memberScopes)).toBe(false);
    });
  });

  describe("Custom Permissions", () => {
    it("should allow viewer with custom permission to create documents", () => {
      const viewerScopes = getDefaultScopesForRole("viewer");
      const customScopes = [...viewerScopes, "documents:create", "documents:update"];

      expect(hasRequiredScope("documents", "create", customScopes)).toBe(true);
      expect(hasRequiredScope("documents", "update", customScopes)).toBe(true);
      expect(hasRequiredScope("documents", "delete", customScopes)).toBe(false);
    });

    it("should allow member with custom permission to delete documents", () => {
      const memberScopes = getDefaultScopesForRole("member");
      const customScopes = [...memberScopes, "documents:delete"];

      expect(hasRequiredScope("documents", "delete", customScopes)).toBe(true);
    });
  });
});
