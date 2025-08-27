import { HayApi } from "@/utils/api";

export default defineNuxtPlugin(() => {
  return {
    provide: {
      api: {
        // Generic HTTP methods (simplified)
        get: async (url: string, options?: any) => {
          console.warn(
            "$api.get is not fully implemented. Use HayApi directly."
          );
          return { data: null };
        },

        post: async (url: string, data?: any) => {
          console.warn(
            "$api.post is not fully implemented. Use HayApi directly."
          );
          return { data: null };
        },

        put: async (url: string, data?: any) => {
          console.warn(
            "$api.put is not fully implemented. Use HayApi directly."
          );
          return { data: null };
        },

        delete: async (url: string) => {
          console.warn(
            "$api.delete is not fully implemented. Use HayApi directly."
          );
          return { data: null };
        },

        // tRPC API
        trpc: HayApi,
      },
    },
  };
});
