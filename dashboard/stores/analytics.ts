import { defineStore } from "pinia";

interface WidgetData {
  data: any;
  timestamp: number;
  error?: string;
}

interface WidgetLoadingState {
  loading: boolean;
  refreshing: boolean;
}

export const useAnalyticsStore = defineStore("analytics", {
  state: () => ({
    widgetData: {} as Record<string, WidgetData>,
    loadingStates: {} as Record<string, WidgetLoadingState>,
  }),
  getters: {
    getWidgetData: (state) => (widgetId: string) => {
      return state.widgetData[widgetId]?.data;
    },
    getWidgetTimestamp: (state) => (widgetId: string) => {
      return state.widgetData[widgetId]?.timestamp;
    },
    getWidgetError: (state) => (widgetId: string) => {
      return state.widgetData[widgetId]?.error;
    },
    isWidgetLoading: (state) => (widgetId: string) => {
      return state.loadingStates[widgetId]?.loading || false;
    },
    isWidgetRefreshing: (state) => (widgetId: string) => {
      return state.loadingStates[widgetId]?.refreshing || false;
    },
  },
  actions: {
    async fetchData(
      widgetId: string,
      fetcher: () => Promise<any>,
      options?: { ttl?: number; forceRefresh?: boolean }
    ) {
      const { ttl = 5 * 60 * 1000, forceRefresh = false } = options || {}; // Default TTL: 5 minutes

      // Check if data exists and is still fresh
      const existingData = this.widgetData[widgetId];
      if (
        !forceRefresh &&
        existingData &&
        !existingData.error &&
        Date.now() - existingData.timestamp < ttl
      ) {
        return existingData.data;
      }

      // Set loading state
      this.setLoadingState(widgetId, forceRefresh ? "refreshing" : "loading", true);

      try {
        const data = await fetcher();

        // Store data with timestamp
        this.widgetData[widgetId] = {
          data,
          timestamp: Date.now(),
        };

        // Clear loading state
        this.setLoadingState(widgetId, forceRefresh ? "refreshing" : "loading", false);

        return data;
      } catch (error) {
        // Store error
        this.widgetData[widgetId] = {
          ...this.widgetData[widgetId],
          error: error instanceof Error ? error.message : "Failed to fetch data",
          timestamp: Date.now(),
        };

        // Clear loading state
        this.setLoadingState(widgetId, forceRefresh ? "refreshing" : "loading", false);

        throw error;
      }
    },

    async refreshData(widgetId: string, fetcher: () => Promise<any>) {
      return this.fetchData(widgetId, fetcher, { forceRefresh: true });
    },

    isDataStale(widgetId: string, ttl: number = 5 * 60 * 1000): boolean {
      const data = this.widgetData[widgetId];
      if (!data) return true;
      return Date.now() - data.timestamp > ttl;
    },

    clearData(widgetId?: string) {
      if (widgetId) {
        delete this.widgetData[widgetId];
        delete this.loadingStates[widgetId];
      } else {
        this.widgetData = {};
        this.loadingStates = {};
      }
    },

    clearError(widgetId: string) {
      if (this.widgetData[widgetId]) {
        delete this.widgetData[widgetId].error;
      }
    },

    setLoadingState(widgetId: string, type: "loading" | "refreshing", value: boolean) {
      if (!this.loadingStates[widgetId]) {
        this.loadingStates[widgetId] = { loading: false, refreshing: false };
      }
      this.loadingStates[widgetId][type] = value;
    },

    getDataAge(widgetId: string): number | null {
      const timestamp = this.getWidgetTimestamp(widgetId);
      if (!timestamp) return null;
      return Date.now() - timestamp;
    },

    formatDataAge(widgetId: string): string {
      const age = this.getDataAge(widgetId);
      if (age === null) return "Never";

      const seconds = Math.floor(age / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
      if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
      if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
      if (seconds > 0) return `${seconds} second${seconds === 1 ? "" : "s"} ago`;
      return "Just now";
    },
  },
  persist: true,
});