import { defineStore } from "pinia";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: "owner" | "admin" | "member" | "viewer";
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  role?: "owner" | "admin" | "member" | "viewer";
  organizations?: Organization[];
  activeOrganizationId?: string;
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

    setActiveOrganization(organizationId: string) {
      if (this.organizations.find((org) => org.id === organizationId)) {
        this.activeOrganizationId = organizationId;
      }
    },

    clearUser() {
      this.user = null;
      this.activeOrganizationId = null;
      this.organizations = [];
    },
  },
  persist: true,
});
