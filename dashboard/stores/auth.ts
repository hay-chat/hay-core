import { defineStore } from "pinia";
import { HayApi } from "~/utils/api";

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export const useAuthStore = defineStore("auth", {
  persist: true,
  state: () => ({
    tokens: null as Tokens | null,
    isAuthenticated: false,
    isInitialized: false,
  }),
  actions: {
    async initializeAuth() {
      const tokens = await HayApi.auth.getTokens.query();
      this.tokens = tokens;
      this.isAuthenticated = true;
      this.isInitialized = true;
    },
  },
});
