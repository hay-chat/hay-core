import { createTRPCProxyClient, httpLink } from '@trpc/client';

// Lazy initialization of tRPC client
let _trpc: any = null;

export const useTRPC = () => {
  if (_trpc) return _trpc;
  
  // Get the API base URL
  const getApiBaseUrl = () => {
    const config = useRuntimeConfig();
    return (
      config.public.apiBaseUrl ||
      (() => {
        if (typeof window !== 'undefined') {
          const hostname = window.location.hostname;
          if (
            hostname.includes('hay.local') ||
            hostname.includes('hay.so') ||
            hostname.includes('hay.ai')
          ) {
            return '';
          }
        }
        return process.env['NODE_ENV'] === 'production'
          ? 'https://api.hay.so'
          : 'http://localhost:3000';
      })()
    );
  };

  // Create tRPC proxy client - using any type for now to avoid complex type imports
  _trpc = createTRPCProxyClient<any>({
    links: [
      httpLink({
        url: `${getApiBaseUrl()}/v1`,
        async headers() {
          // Get the auth token from the auth store
          const authStore = useAuthStore();
          const token = authStore.accessToken;
          
          return {
            'Content-Type': 'application/json',
            ...(token && { authorization: `Bearer ${token}` }),
          };
        },
      }),
    ],
  });
  
  return _trpc;
};

// Export for backward compatibility
export const trpc = new Proxy({} as any, {
  get(target, prop) {
    return useTRPC()[prop];
  }
});