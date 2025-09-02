import { useRuntimeConfig } from "nuxt/app";

export const useDomain = () => {
  const config = useRuntimeConfig();

  /**
   * Get the current organization from the current hostname
   */
  const getCurrentOrganization = (): string | null => {
    if (process.client) {
      const host = window.location.hostname;
      const baseDomain = config.public.baseDomain;

      // Remove port if present
      const hostWithoutPort = host.split(":")[0];
      const parts = hostWithoutPort ? hostWithoutPort.split(".") : [];

      // For hay.local setup: organization.hay.local (3 parts) or hay.local (2 parts - main app)
      if (parts.length >= 3) {
        const organization = parts[0];
        const domain = parts.slice(1).join(".");

        // Check if this matches our base domain
        if (domain === baseDomain) {
          return organization ?? null;
        }
      }

      // If it's just hay.local (main domain), return null for default organization
      if (parts.length === 2 && hostWithoutPort === baseDomain) {
        return null;
      }
    }

    return null;
  };

  /**
   * Generate URL for a organization subdomain
   */
  const getOrganizationUrl = (
    organization: string,
    path: string = "/"
  ): string => {
    const baseDomain = config.public.baseDomain;
    const protocol =
      process.env["NODE_ENV"] === "development" ? "http" : "https";

    // In development, check if we're already on a proxied domain (no port in URL)
    const currentPort = process.client ? window.location.port : "";
    const port =
      process.env["NODE_ENV"] === "development" && currentPort
        ? `:${currentPort}`
        : "";

    return `${protocol}://${organization}.${baseDomain}${port}${path}`;
  };

  /**
   * Generate URL for the main domain
   */
  const getMainUrl = (path: string = "/"): string => {
    const baseDomain = config.public.baseDomain;
    const protocol =
      process.env["NODE_ENV"] === "development" ? "http" : "https";

    // In development, check if we're already on a proxied domain (no port in URL)
    const currentPort = process.client ? window.location.port : "";
    const port =
      process.env["NODE_ENV"] === "development" && currentPort
        ? `:${currentPort}`
        : "";

    return `${protocol}://${baseDomain}${port}${path}`;
  };

  /**
   * Get API URL with proper organization context
   */
  const getApiUrl = (endpoint: string = "", organization?: string): string => {
    let apiUrl = config.public.apiBaseUrl;

    // If organization is provided and we're in development, use organization subdomain
    if (organization && process.env["NODE_ENV"] === "development") {
      const baseDomain = config.public.baseDomain;
      apiUrl = `http://${organization}.${baseDomain}:3001`;
    }

    return `${apiUrl}${endpoint}`;
  };

  return {
    getCurrentOrganization,
    getOrganizationUrl,
    getMainUrl,
    getApiUrl,
    baseDomain: config.public.baseDomain,
    apiBaseUrl: config.public.apiBaseUrl,
  };
};
