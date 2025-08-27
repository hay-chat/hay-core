// Global type declarations for Nuxt plugins

declare module "#app" {
  interface NuxtApp {
    $api: {
      get: (url: string, options?: any) => Promise<{ data: any }>;
      post: (url: string, data?: any) => Promise<{ data: any }>;
      put: (url: string, data?: any) => Promise<{ data: any }>;
      delete: (url: string) => Promise<{ data: any }>;
      trpc: any;
    };
  }
}

declare module "@vue/runtime-core" {
  interface ComponentCustomProperties {
    $api: {
      get: (url: string, options?: any) => Promise<{ data: any }>;
      post: (url: string, data?: any) => Promise<{ data: any }>;
      put: (url: string, data?: any) => Promise<{ data: any }>;
      delete: (url: string) => Promise<{ data: any }>;
      trpc: any;
    };
  }
}

export {};
