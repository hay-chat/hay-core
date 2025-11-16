import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";

/**
 * RBAC Tests for Agents Resource
 * Tests role-based access control for agent creation, modification, deletion, and execution
 */
describe("RBAC - Agents Resource", () => {
  describe("Agent Creation (agents:create)", () => {
    it("should allow owner to create agents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(true);
    });

    it("should allow admin to create agents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(true);
    });

    it("should allow contributor to create agents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(true);
    });

    it("should deny member from creating agents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(false);
    });

    it("should deny viewer from creating agents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(false);
    });

    it("should deny agent role from creating agents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("agents", "create", scopes)).toBe(false);
    });
  });

  describe("Agent Reading (agents:read)", () => {
    it("should allow owner to read agents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(true);
    });

    it("should allow admin to read agents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(true);
    });

    it("should allow contributor to read agents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(true);
    });

    it("should allow member to read agents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(true);
    });

    it("should allow viewer to read agents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(true);
    });

    it("should deny agent role from reading agents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("agents", "read", scopes)).toBe(false);
    });
  });

  describe("Agent Update (agents:update)", () => {
    it("should allow owner to update agents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(true);
    });

    it("should allow admin to update agents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(true);
    });

    it("should allow contributor to update agents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(true);
    });

    it("should deny member from updating agents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(false);
    });

    it("should deny viewer from updating agents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(false);
    });

    it("should deny agent role from updating agents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("agents", "update", scopes)).toBe(false);
    });
  });

  describe("Agent Deletion (agents:delete)", () => {
    it("should allow owner to delete agents", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(true);
    });

    it("should allow admin to delete agents", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(true);
    });

    it("should deny contributor from deleting agents", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(false);
    });

    it("should deny member from deleting agents", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(false);
    });

    it("should deny viewer from deleting agents", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(false);
    });

    it("should deny agent role from deleting agents", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("agents", "delete", scopes)).toBe(false);
    });
  });

  describe("Permission Escalation Prevention", () => {
    it("should prevent member from bypassing restrictions with wildcard", () => {
      const memberScopes = getDefaultScopesForRole("member");

      // Member should not have wildcard permissions
      expect(memberScopes).not.toContain("*:*");
      expect(memberScopes).not.toContain("agents:*");
    });

    it("should ensure only owner/admin have full access", () => {
      const ownerScopes = getDefaultScopesForRole("owner");
      const adminScopes = getDefaultScopesForRole("admin");

      expect(ownerScopes).toContain("*:*");
      expect(adminScopes).toContain("*:*");
    });

    it("should prevent agent role from having any write access to agents", () => {
      const agentScopes = getDefaultScopesForRole("agent");

      expect(hasRequiredScope("agents", "create", agentScopes)).toBe(false);
      expect(hasRequiredScope("agents", "update", agentScopes)).toBe(false);
      expect(hasRequiredScope("agents", "delete", agentScopes)).toBe(false);
      expect(hasRequiredScope("agents", "read", agentScopes)).toBe(false); // Agent role doesn't need agent access
    });
  });

  describe("Custom Permissions", () => {
    it("should allow member with custom permissions to create agents", () => {
      const memberScopes = getDefaultScopesForRole("member");
      const customScopes = [...memberScopes, "agents:create"];

      expect(hasRequiredScope("agents", "create", customScopes)).toBe(true);
    });

    it("should allow viewer with custom wildcard to have full agent access", () => {
      const viewerScopes = getDefaultScopesForRole("viewer");
      const customScopes = [...viewerScopes, "agents:*"];

      expect(hasRequiredScope("agents", "create", customScopes)).toBe(true);
      expect(hasRequiredScope("agents", "update", customScopes)).toBe(true);
      expect(hasRequiredScope("agents", "delete", customScopes)).toBe(true);
    });
  });
});
