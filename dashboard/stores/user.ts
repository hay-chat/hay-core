import { defineStore } from "pinia";
import { ref, computed } from "vue";

interface User {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  organizationName: string;
}

export const useUserStore = defineStore("user", {
  persist: true,
  state: () => ({
    user: null as User | null,
  }),
  actions: {
    async fetchUser() {
      const user = await HayApi.user.me.query();
      this.user = user;
    },
  },
});
