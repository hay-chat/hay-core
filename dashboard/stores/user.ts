import { defineStore } from "pinia";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  role?: "owner" | "admin" | "member" | "viewer" | "contributor";
  permissions?: string[];
  joinedAt?: Date;
  lastAccessedAt?: Date;
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  role?: "owner" | "admin" | "member" | "viewer" | "contributor";
  organizations?: Organization[];
  activeOrganizationId?: string;
  lastSeenAt?: Date;
  status?: "available" | "away";
  onlineStatus?: "online" | "away" | "offline";
  pendingEmail?: string;
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
  },
  actions: {
    setUser(userData: User) {
      this.user = {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
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
