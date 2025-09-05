import { defineStore } from "pinia";
import { Hay } from "@/utils/api";

interface AppState {
  openConversationsCount: number;
  lastUpdated: number | null;
  isLoading: boolean;
}

export const useAppStore = defineStore("app", {
  persist: true,
  state: (): AppState => ({
    openConversationsCount: 0,
    lastUpdated: null,
    isLoading: false,
  }),
  
  getters: {
    shouldRefreshCount: (state) => {
      if (!state.lastUpdated) return true;
      // Refresh if data is older than 5 minutes
      const fiveMinutes = 5 * 60 * 1000;
      return Date.now() - state.lastUpdated > fiveMinutes;
    },
  },

  actions: {
    async fetchOpenConversationsCount() {
      try {
        this.isLoading = true;
        
        const result = await Hay.conversations.list.query({
          filters: { status: "open" },
          pagination: { page: 1, limit: 1 }, // We only need the count, not the data
        });

        this.openConversationsCount = result.pagination.total;
        this.lastUpdated = Date.now();
        
        return this.openConversationsCount;
      } catch (error) {
        console.error("[AppStore] Failed to fetch conversations count:", error);
        // Don't update count on error to maintain last known value
        return this.openConversationsCount;
      } finally {
        this.isLoading = false;
      }
    },

    async refreshConversationsCount() {
      // Always fetch fresh data
      return await this.fetchOpenConversationsCount();
    },

    async getOpenConversationsCount() {
      // Return cached value if recent, otherwise fetch fresh
      if (this.shouldRefreshCount) {
        return await this.fetchOpenConversationsCount();
      }
      return this.openConversationsCount;
    },

    // Method to manually update count (useful when creating/closing conversations)
    updateConversationsCount(count: number) {
      this.openConversationsCount = count;
      this.lastUpdated = Date.now();
    },

    // Method to increment/decrement count without full refresh
    incrementConversationsCount() {
      this.openConversationsCount++;
      this.lastUpdated = Date.now();
    },

    decrementConversationsCount() {
      if (this.openConversationsCount > 0) {
        this.openConversationsCount--;
        this.lastUpdated = Date.now();
      }
    },
  },
});

export type AppStore = ReturnType<typeof useAppStore>;