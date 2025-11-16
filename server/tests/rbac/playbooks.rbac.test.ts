import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";

/**
 * RBAC Tests for Playbooks Resource
 * Tests role-based access control for playbook creation, modification, deletion, publishing, and execution
 */
describe("RBAC - Playbooks Resource", () => {
  describe("Playbook Creation (playbooks:create)", () => {
    it("should allow owner to create playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(true);
    });

    it("should allow admin to create playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(true);
    });

    it("should allow contributor to create playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(true);
    });

    it("should deny member from creating playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(false);
    });

    it("should deny viewer from creating playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(false);
    });

    it("should deny agent role from creating playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "create", scopes)).toBe(false);
    });
  });

  describe("Playbook Reading (playbooks:read)", () => {
    it("should allow owner to read playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });

    it("should allow admin to read playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });

    it("should allow contributor to read playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });

    it("should allow member to read playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });

    it("should allow viewer to read playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });

    it("should allow agent role to read playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "read", scopes)).toBe(true);
    });
  });

  describe("Playbook Update (playbooks:update)", () => {
    it("should allow owner to update playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(true);
    });

    it("should allow admin to update playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(true);
    });

    it("should allow contributor to update playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(true);
    });

    it("should deny member from updating playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(false);
    });

    it("should deny viewer from updating playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(false);
    });

    it("should deny agent role from updating playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "update", scopes)).toBe(false);
    });
  });

  describe("Playbook Deletion (playbooks:delete)", () => {
    it("should allow owner to delete playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(true);
    });

    it("should allow admin to delete playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(true);
    });

    it("should deny contributor from deleting playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(false);
    });

    it("should deny member from deleting playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(false);
    });

    it("should deny viewer from deleting playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(false);
    });

    it("should deny agent role from deleting playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "delete", scopes)).toBe(false);
    });
  });

  describe("Playbook Publishing (playbooks:publish)", () => {
    it("should allow owner to publish playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(true);
    });

    it("should allow admin to publish playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(true);
    });

    it("should deny contributor from publishing playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(false);
    });

    it("should deny member from publishing playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(false);
    });

    it("should deny viewer from publishing playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(false);
    });

    it("should deny agent role from publishing playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "publish", scopes)).toBe(false);
    });
  });

  describe("Playbook Execution (playbooks:execute)", () => {
    it("should allow owner to execute playbooks", () => {
      const scopes = getDefaultScopesForRole("owner");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(true);
    });

    it("should allow admin to execute playbooks", () => {
      const scopes = getDefaultScopesForRole("admin");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(true);
    });

    it("should allow agent role to execute playbooks", () => {
      const scopes = getDefaultScopesForRole("agent");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(true);
    });

    it("should deny member from executing playbooks", () => {
      const scopes = getDefaultScopesForRole("member");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(false);
    });

    it("should deny viewer from executing playbooks", () => {
      const scopes = getDefaultScopesForRole("viewer");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(false);
    });

    it("should deny contributor from executing playbooks", () => {
      const scopes = getDefaultScopesForRole("contributor");
      expect(hasRequiredScope("playbooks", "execute", scopes)).toBe(false);
    });
  });

  describe("Permission Escalation Prevention", () => {
    it("should prevent contributor from publishing without explicit permission", () => {
      const contributorScopes = getDefaultScopesForRole("contributor");

      // Contributor can create and update but not publish or delete
      expect(hasRequiredScope("playbooks", "create", contributorScopes)).toBe(true);
      expect(hasRequiredScope("playbooks", "update", contributorScopes)).toBe(true);
      expect(hasRequiredScope("playbooks", "publish", contributorScopes)).toBe(false);
      expect(hasRequiredScope("playbooks", "delete", contributorScopes)).toBe(false);
    });

    it("should ensure agent role can only read and execute", () => {
      const agentScopes = getDefaultScopesForRole("agent");

      expect(hasRequiredScope("playbooks", "read", agentScopes)).toBe(true);
      expect(hasRequiredScope("playbooks", "execute", agentScopes)).toBe(true);
      expect(hasRequiredScope("playbooks", "create", agentScopes)).toBe(false);
      expect(hasRequiredScope("playbooks", "update", agentScopes)).toBe(false);
      expect(hasRequiredScope("playbooks", "delete", agentScopes)).toBe(false);
      expect(hasRequiredScope("playbooks", "publish", agentScopes)).toBe(false);
    });
  });

  describe("Custom Permissions", () => {
    it("should allow contributor with custom permission to publish", () => {
      const contributorScopes = getDefaultScopesForRole("contributor");
      const customScopes = [...contributorScopes, "playbooks:publish"];

      expect(hasRequiredScope("playbooks", "publish", customScopes)).toBe(true);
    });

    it("should allow agent with custom permission to create playbooks", () => {
      const agentScopes = getDefaultScopesForRole("agent");
      const customScopes = [...agentScopes, "playbooks:create", "playbooks:update"];

      expect(hasRequiredScope("playbooks", "create", customScopes)).toBe(true);
      expect(hasRequiredScope("playbooks", "update", customScopes)).toBe(true);
    });
  });
});
