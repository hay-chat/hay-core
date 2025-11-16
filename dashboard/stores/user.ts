import { defineStore } from "pinia";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  role?: "owner" | "admin" | "member" | "viewer" | "contributor" | "agent";
  permissions?: string[] | null;
  joinedAt?: Date;
  lastAccessedAt?: Date;
}

export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
  isAdmin?: boolean;
  role?: "owner" | "admin" | "member" | "viewer" | "contributor" | "agent";
  organizations?: Organization[];
  activeOrganizationId?: string;
  lastSeenAt?: Date;
  status?: "available" | "away";
  onlineStatus?: "online" | "away" | "offline";
  pendingEmail?: string | null;
  emailVerificationExpiresAt?: Date;
}

export const useUserStore = defineStore("user", {
  state: () => ({
    user: null as User | null,
    activeOrganizationId: null as string | null,
    organizations: [] as Organization[],
  }),
  getters: {
    activeOrganization: (state) => {
      return state.organizations.find((org) => org.id === state.activeOrganizationId) || null;
    },
    currentOrganization: (state) => {
      return state.organizations.find((org) => org.id === state.activeOrganizationId) || null;
    },
    userRole: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      return activeOrg?.role || state.user?.role || "member";
    },
    isOwner: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      return activeOrg?.role === "owner";
    },
    isAdmin: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      return activeOrg?.role === "owner" || activeOrg?.role === "admin";
    },
    isAgent: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      return activeOrg?.role === "agent";
    },

    // Helper to check if user has a specific scope
    hasScope: (state) => {
      return (resource: string, action: string): boolean => {
        const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);

        // Owner and admin have full access
        if (activeOrg?.role === "owner" || activeOrg?.role === "admin") {
          return true;
        }

        // Check if user has the specific scope
        const requiredScope = `${resource}:${action}`;
        const permissions = activeOrg?.permissions || [];

        return permissions.some((permission) => {
          const [permResource, permAction] = permission.split(":");

          // Exact match
          if (permission === requiredScope) return true;

          // Wildcard resource match
          if (permResource === "*" && permAction === action) return true;

          // Wildcard action match
          if (permResource === resource && permAction === "*") return true;

          // Full wildcard
          if (permission === "*:*") return true;

          return false;
        });
      };
    },

    // Enhanced permission helpers for common operations
    canCreateAgents: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "agents:create" || p === "agents:*" || p === "*:*" || p === "*:create");
    },

    canEditAgents: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "agents:update" || p === "agents:*" || p === "*:*" || p === "*:update");
    },

    canDeleteAgents: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "agents:delete" || p === "agents:*" || p === "*:*" || p === "*:delete");
    },

    canCreatePlaybooks: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "playbooks:create" || p === "playbooks:*" || p === "*:*" || p === "*:create");
    },

    canEditPlaybooks: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "playbooks:update" || p === "playbooks:*" || p === "*:*" || p === "*:update");
    },

    canDeletePlaybooks: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "playbooks:delete" || p === "playbooks:*" || p === "*:*" || p === "*:delete");
    },

    canPublishPlaybooks: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "playbooks:publish" || p === "playbooks:*" || p === "*:*" || p === "*:publish");
    },

    canAccessAnalytics: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "analytics:read" || p === "analytics:*" || p === "*:*" || p === "*:read");
    },

    canManageUsers: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "organization_members:update" || p === "organization_members:*" || p === "*:*" || p === "*:update");
    },

    canManageApiKeys: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "api_keys:create" || p === "api_keys:*" || p === "*:*" || p === "*:create");
    },

    canManageOrganization: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      if (activeOrg?.role === "owner" || activeOrg?.role === "admin") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "organizations:update" || p === "organizations:*" || p === "*:*" || p === "*:update");
    },

    canExportData: (state) => {
      const activeOrg = state.organizations.find((org) => org.id === state.activeOrganizationId);
      // Only owners can export audit logs
      if (activeOrg?.role === "owner") return true;
      const permissions = activeOrg?.permissions || [];
      return permissions.some(p => p === "audit_logs:export" || p === "audit_logs:*" || p === "*:*" || p === "*:export");
    },
  },
  actions: {
    setUser(userData: User) {
      this.user = {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        avatarUrl: userData.avatarUrl,
        isActive: userData.isActive,
        isAdmin: userData.isAdmin,
        role: userData.role,
        lastSeenAt: userData.lastSeenAt,
        status: userData.status,
        onlineStatus: userData.onlineStatus,
        pendingEmail: userData.pendingEmail,
        emailVerificationExpiresAt: userData.emailVerificationExpiresAt,
      };

      // Set organizations if provided
      if (userData.organizations) {
        this.organizations = userData.organizations;
      }

      // Set active organization
      if (userData.activeOrganizationId) {
        this.activeOrganizationId = userData.activeOrganizationId;
      } else if (this.organizations.length > 0) {
        // Default to first organization if no active one is set
        this.activeOrganizationId = this.organizations[0].id;
      }
    },

    updateStatus(status: "available" | "away") {
      if (this.user) {
        this.user.status = status;
        // Update onlineStatus based on new status
        if (status === "away") {
          this.user.onlineStatus = "away";
        } else {
          // Will be "online" if lastSeenAt is recent
          this.user.onlineStatus = "online";
        }
      }
    },

    setActiveOrganization(organizationId: string) {
      if (this.organizations.find((org) => org.id === organizationId)) {
        this.activeOrganizationId = organizationId;
      }
    },

    /**
     * Switch to a different organization
     * This updates the active organization and returns the organization info
     */
    async switchOrganization(organizationId: string): Promise<Organization | null> {
      const targetOrg = this.organizations.find((org) => org.id === organizationId);
      if (!targetOrg) {
        return null;
      }

      // Update the active organization ID
      // This will cause the tRPC client to use the new org ID in the x-organization-id header
      this.activeOrganizationId = organizationId;

      return targetOrg;
    },

    clearUser() {
      this.user = null;
      this.activeOrganizationId = null;
      this.organizations = [];
    },
  },
  persist: true,
});
