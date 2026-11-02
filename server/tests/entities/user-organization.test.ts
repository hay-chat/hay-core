import { UserOrganization } from "@server/entities/user-organization.entity";

describe("UserOrganization Entity", () => {
  describe("hasScope", () => {
    it("should check scopes correctly for owner role", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "owner";
      userOrg.isActive = true;

      expect(userOrg.hasScope("conversations", "read")).toBe(true);
      expect(userOrg.hasScope("documents", "delete")).toBe(true);
      expect(userOrg.hasScope("assistant", "update")).toBe(true);
      expect(userOrg.hasScope("*", "*")).toBe(true);
    });

    it("should check scopes correctly for admin role", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "admin";
      userOrg.isActive = true;

      expect(userOrg.hasScope("conversations", "read")).toBe(true);
      expect(userOrg.hasScope("documents", "delete")).toBe(true);
      expect(userOrg.hasScope("organization_members", "manage")).toBe(true);
    });

    it("should check scopes correctly for contributor role", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "contributor";
      userOrg.isActive = true;

      // Contributors can edit the assistant and create playbooks
      expect(userOrg.hasScope("assistant", "update")).toBe(true);
      expect(userOrg.hasScope("playbooks", "create")).toBe(true);
      expect(userOrg.hasScope("conversations", "create")).toBe(true);

      // But cannot delete them
      expect(userOrg.hasScope("playbooks", "delete")).toBe(false);
      expect(userOrg.hasScope("playbooks", "delete")).toBe(false);
    });

    it("should check scopes correctly for member role", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "member";
      userOrg.isActive = true;

      // Members have full access to conversations and documents
      expect(userOrg.hasScope("conversations", "create")).toBe(true);
      expect(userOrg.hasScope("documents", "create")).toBe(true);

      // But only read access to the assistant
      expect(userOrg.hasScope("assistant", "read")).toBe(true);
      expect(userOrg.hasScope("assistant", "update")).toBe(false);
    });

    it("should check scopes correctly for viewer role", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "viewer";
      userOrg.isActive = true;

      // Viewers only have read access
      expect(userOrg.hasScope("conversations", "read")).toBe(true);
      expect(userOrg.hasScope("documents", "read")).toBe(true);
      expect(userOrg.hasScope("assistant", "read")).toBe(true);

      // No create/update/delete
      expect(userOrg.hasScope("conversations", "create")).toBe(false);
      expect(userOrg.hasScope("documents", "update")).toBe(false);
      expect(userOrg.hasScope("playbooks", "delete")).toBe(false);
    });

    it("should return false for inactive users", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "owner";
      userOrg.isActive = false;

      expect(userOrg.hasScope("conversations", "read")).toBe(false);
      expect(userOrg.hasScope("*", "*")).toBe(false);
    });

    it("should support custom permissions", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "viewer";
      userOrg.isActive = true;
      userOrg.permissions = ["conversations:create", "documents:create"];

      // Viewer normally can't create, but custom permissions allow it
      expect(userOrg.hasScope("conversations", "create")).toBe(true);
      expect(userOrg.hasScope("documents", "create")).toBe(true);

      // Still restricted from other create operations
      expect(userOrg.hasScope("assistant", "update")).toBe(false);
    });

    it("should combine role defaults with custom permissions", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "member";
      userOrg.isActive = true;
      userOrg.permissions = ["assistant:update", "playbooks:create"];

      // Has member default scopes
      expect(userOrg.hasScope("conversations", "create")).toBe(true);

      // Plus custom scopes
      expect(userOrg.hasScope("assistant", "update")).toBe(true);
      expect(userOrg.hasScope("playbooks", "create")).toBe(true);
    });
  });

  describe("getScopes", () => {
    it("should return all scopes for owner", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "owner";

      const scopes = userOrg.getScopes();
      expect(scopes).toContain("*:*");
    });

    it("should return combined scopes with custom permissions", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "viewer";
      userOrg.permissions = ["conversations:create"];

      const scopes = userOrg.getScopes();
      expect(scopes).toContain("conversations:read");
      expect(scopes).toContain("conversations:create");
    });

    it("should return empty array for null permissions", () => {
      const userOrg = new UserOrganization();
      userOrg.role = "viewer";
      userOrg.permissions = null as any;

      const scopes = userOrg.getScopes();
      expect(Array.isArray(scopes)).toBe(true);
      expect(scopes.length).toBeGreaterThan(0); // Has role defaults
    });
  });

  describe("updateLastAccessed", () => {
    it("should update lastAccessedAt timestamp", () => {
      const userOrg = new UserOrganization();
      const before = new Date();

      userOrg.updateLastAccessed();

      expect(userOrg.lastAccessedAt).toBeInstanceOf(Date);
      expect(userOrg.lastAccessedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("should update to current time on multiple calls", () => {
      const userOrg = new UserOrganization();

      userOrg.updateLastAccessed();
      const firstTime = userOrg.lastAccessedAt;

      // Wait a tiny bit
      setTimeout(() => {
        userOrg.updateLastAccessed();
        const secondTime = userOrg.lastAccessedAt;

        expect(secondTime!.getTime()).toBeGreaterThanOrEqual(firstTime!.getTime());
      }, 10);
    });
  });

  describe("Role-based Permission Hierarchy", () => {
    it("should enforce permission hierarchy: owner > admin", () => {
      const owner = new UserOrganization();
      owner.role = "owner";
      owner.isActive = true;

      const admin = new UserOrganization();
      admin.role = "admin";
      admin.isActive = true;

      // Both have full access
      expect(owner.hasScope("*", "*")).toBe(true);
      expect(admin.hasScope("*", "*")).toBe(true);
    });

    it("should enforce permission hierarchy: admin > contributor", () => {
      const admin = new UserOrganization();
      admin.role = "admin";
      admin.isActive = true;

      const contributor = new UserOrganization();
      contributor.role = "contributor";
      contributor.isActive = true;

      // Admin can delete playbooks, contributor cannot
      expect(admin.hasScope("playbooks", "delete")).toBe(true);
      expect(contributor.hasScope("playbooks", "delete")).toBe(false);
    });

    it("should enforce permission hierarchy: contributor > member", () => {
      const contributor = new UserOrganization();
      contributor.role = "contributor";
      contributor.isActive = true;

      const member = new UserOrganization();
      member.role = "member";
      member.isActive = true;

      // Contributor can edit the assistant, member cannot
      expect(contributor.hasScope("assistant", "update")).toBe(true);
      expect(member.hasScope("assistant", "update")).toBe(false);
    });

    it("should enforce permission hierarchy: member > viewer", () => {
      const member = new UserOrganization();
      member.role = "member";
      member.isActive = true;

      const viewer = new UserOrganization();
      viewer.role = "viewer";
      viewer.isActive = true;

      // Member can create conversations, viewer cannot
      expect(member.hasScope("conversations", "create")).toBe(true);
      expect(viewer.hasScope("conversations", "create")).toBe(false);
    });
  });
});
