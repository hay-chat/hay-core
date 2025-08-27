import { defineStore } from "pinia";

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
  isAdmin?: boolean;
  organizationId?: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
}

export const useUserStore = defineStore("user", {
  persist: true,
  state: () => ({
    user: null as User | null,
  }),
  actions: {
    setUser(user: User) {
      this.user = user;
    },

    clearUser() {
      this.user = null;
    },
  },
});
