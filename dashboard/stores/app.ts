import { defineStore } from "pinia";
import { Hay } from "@/utils/api";

interface Plugin {
  id: string;
  dbId: string;
  name: string;
  version: string;
  type: string[];
  description?: string;
  installed: boolean;
  built: boolean;
  enabled: boolean;
  hasConfiguration: boolean;
  hasCustomUI: boolean;
  capabilities?: Record<string, unknown>;
  features?: Record<string, unknown>;
}

interface AppState {
  openConversationsCount: number;
  lastUpdated: number | null;
  isLoading: boolean;
  plugins: Plugin[];
  pluginsLastUpdated: number | null;
  pluginsLoading: boolean;
}

export const useAppStore = defineStore("app", {
  persist: true,
  state: (): AppState => ({
    openConversationsCount: 0,
    lastUpdated: null,
    isLoading: false,
    plugins: [],
    pluginsLastUpdated: null,
    pluginsLoading: false,
  }),

  getters: {
    shouldRefreshCount: (state) => {
      if (!state.lastUpdated) return true;
      // Refresh if data is older than 5 minutes
      const fiveMinutes = 5 * 60 * 1000;
      return Date.now() - state.lastUpdated > fiveMinutes;
    },

    enabledPlugins: (state): Plugin[] => {
      return state.plugins.filter((plugin) => plugin.enabled);
    },

    availablePlugins: (state): Plugin[] => {
      return state.plugins.filter((plugin) => !plugin.enabled);
    },

    shouldRefreshPlugins: (state) => {
      if (!state.pluginsLastUpdated) return true;
      // Refresh if data is older than 5 minutes
      const fiveMinutes = 5 * 60 * 1000;
      return Date.now() - state.pluginsLastUpdated > fiveMinutes;
    },

    getPluginById:
      (state) =>
      (id: string): Plugin | undefined => {
        return state.plugins.find((plugin) => plugin.id === id);
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

    // Plugin management actions
    async fetchPlugins() {
      try {
        this.pluginsLoading = true;
        const response = await Hay.plugins.getAll.query();
        this.plugins = response;
        this.pluginsLastUpdated = Date.now();
        return this.plugins;
      } catch (error) {
        console.error("[AppStore] Failed to fetch plugins:", error);
        return this.plugins;
      } finally {
        this.pluginsLoading = false;
      }
    },

    async refreshPlugins() {
      return await this.fetchPlugins();
    },

    async getPlugins() {
      if (this.shouldRefreshPlugins) {
        return await this.fetchPlugins();
      }
      return this.plugins;
    },

    async enablePlugin(pluginId: string, configuration?: Record<string, unknown>) {
      try {
        await Hay.plugins.enable.mutate({ pluginId, configuration });
        await this.fetchPlugins(); // Refresh to get updated status
        return { success: true };
      } catch (error) {
        console.error("[AppStore] Failed to enable plugin:", error);
        throw error;
      }
    },

    async disablePlugin(pluginId: string) {
      try {
        await Hay.plugins.disable.mutate({ pluginId });
        await this.fetchPlugins(); // Refresh to get updated status
        return { success: true };
      } catch (error) {
        console.error("[AppStore] Failed to disable plugin:", error);
        throw error;
      }
    },

    // Method to manually update plugin status without full refresh
    updatePluginStatus(pluginId: string, enabled: boolean) {
      const plugin = this.plugins.find((p) => p.id === pluginId);
      if (plugin) {
        plugin.enabled = enabled;
        this.pluginsLastUpdated = Date.now();
      }
    },
  },
});

export type AppStore = ReturnType<typeof useAppStore>;
