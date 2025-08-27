import { useRuntimeConfig } from 'nuxt/app';

export const useDomain = () => {
  const config = useRuntimeConfig();

  /**
   * Get the current tenant from the current hostname
   */
  const getCurrentTenant = (): string | null => {
    if (process.client) {
      const host = window.location.hostname;
      const baseDomain = config.public.baseDomain;

      // Remove port if present
      const hostWithoutPort = host.split(':')[0];
      const parts = hostWithoutPort ? hostWithoutPort.split('.') : [];

      // For hay.local setup: tenant.hay.local (3 parts) or hay.local (2 parts - main app)
      if (parts.length >= 3) {
        const tenant = parts[0];
        const domain = parts.slice(1).join('.');

        // Check if this matches our base domain
        if (domain === baseDomain) {
          return tenant ?? null;
        }
      }

      // If it's just hay.local (main domain), return null for default tenant
      if (parts.length === 2 && hostWithoutPort === baseDomain) {
        return null;
      }
    }

    return null;
  };

  /**
   * Generate URL for a tenant subdomain
   */
  const getTenantUrl = (tenant: string, path: string = '/'): string => {
    const baseDomain = config.public.baseDomain;
    const protocol = process.env['NODE_ENV'] === 'development' ? 'http' : 'https';

    // In development, check if we're already on a proxied domain (no port in URL)
    const currentPort = process.client ? window.location.port : '';
    const port = process.env['NODE_ENV'] === 'development' && currentPort ? `:${currentPort}` : '';

    return `${protocol}://${tenant}.${baseDomain}${port}${path}`;
  };

  /**
   * Generate URL for the main domain
   */
  const getMainUrl = (path: string = '/'): string => {
    const baseDomain = config.public.baseDomain;
    const protocol = process.env['NODE_ENV'] === 'development' ? 'http' : 'https';

    // In development, check if we're already on a proxied domain (no port in URL)
    const currentPort = process.client ? window.location.port : '';
    const port = process.env['NODE_ENV'] === 'development' && currentPort ? `:${currentPort}` : '';

    return `${protocol}://${baseDomain}${port}${path}`;
  };

  /**
   * Get API URL with proper tenant context
   */
  const getApiUrl = (endpoint: string = '', tenant?: string): string => {
    let apiUrl = config.public.apiBaseUrl;

    // If tenant is provided and we're in development, use tenant subdomain
    if (tenant && process.env['NODE_ENV'] === 'development') {
      const baseDomain = config.public.baseDomain;
      apiUrl = `http://${tenant}.${baseDomain}:3000`;
    }

    return `${apiUrl}${endpoint}`;
  };

  return {
    getCurrentTenant,
    getTenantUrl,
    getMainUrl,
    getApiUrl,
    baseDomain: config.public.baseDomain,
    apiBaseUrl: config.public.apiBaseUrl,
  };
};
