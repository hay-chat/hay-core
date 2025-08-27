import type { FetchOptions } from 'ofetch';
import { useAuthStore } from '~/stores/auth';

export interface ApiOptions extends Omit<FetchOptions, 'baseURL'> {
  skipAuth?: boolean;
}

// Extend FetchOptions to include our custom properties
interface ExtendedFetchOptions extends FetchOptions {
  skipAuth?: boolean;
  _retry?: boolean;
  _rateLimitRetry?: boolean;
  _retryCount?: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  statusMessage: string;
  data?: any;
}

export const useApi = () => {
  const config = useRuntimeConfig();
  const authStore = useAuthStore();

  const baseURL =
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
        : 'http://localhost:3001';
    })();

  const apiClient: ReturnType<typeof $fetch.create> = $fetch.create({
    baseURL,
    credentials: 'include',
    
    onRequest({ options }) {
      const opts = options as ExtendedFetchOptions;
      if (!authStore.isInitialized) {
        return;
      }

      if (authStore.accessToken && !opts.skipAuth) {
        const headers = options.headers || {};
        options.headers = {
          ...headers,
          Authorization: `Bearer ${authStore.accessToken}`,
        } as any;
      }

      authStore.updateActivity();

      if (authStore.shouldRefreshToken && !(options as any).url?.includes('/auth/refresh')) {
        // Queue token refresh but don't block
      }
    },

    async onResponseError({ request, response, options }) {
      // Handle 401 Unauthorized
      if (response.status === 401 && !request.toString().includes('/auth/')) {
        const retryFlag = (options as any)._retry;
        if (!retryFlag && authStore.tokens?.refreshToken) {
          try {
            await authStore.refreshToken();

            // Retry the original request with new token
            const retryOptions = {
              ...options,
              headers: {
                ...((options.headers as any) || {}),
                Authorization: `Bearer ${authStore.accessToken}`,
              },
              _retry: true,
            };
            return await apiClient(request as string, retryOptions as any);
          } catch (error) {
            await authStore.logout();
            await navigateTo('/login');
          }
        } else {
          await authStore.logout();
          await navigateTo('/login');
        }
      }

      // Handle 403 Forbidden
      if (response.status === 403) {
        console.error('Access forbidden:', request);
        if (typeof window !== 'undefined') {
          console.error('You do not have permission to perform this action');
        }
      }

      // Handle 422 Validation errors
      if (response.status === 422) {
        const errors = response._data?.errors || {};
        console.error('Validation errors:', errors);

        return Promise.reject({
          statusCode: 422,
          statusMessage: 'Validation failed',
          data: errors,
        } as ApiErrorResponse);
      }

      // Handle 429 Rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        console.warn(`Rate limited. Retry after ${retryAfter} seconds`);

        const rateLimitRetry = (options as any)._rateLimitRetry;
        if (retryAfter && !rateLimitRetry) {
          const delay = parseInt(retryAfter) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          return await apiClient(request as string, {
            ...options,
            _rateLimitRetry: true,
          } as any);
        }
      }

      // Handle 500+ Server errors with exponential backoff
      if (response.status >= 500) {
        console.error('Server error:', response.status, response.statusText);

        const retryCount = (options as any)._retryCount || 0;
        if (retryCount < 3) {
          const newRetryCount = retryCount + 1;
          const delay = Math.min(1000 * Math.pow(2, newRetryCount - 1), 10000);

          await new Promise((resolve) => setTimeout(resolve, delay));

          return await apiClient(request as string, {
            ...options,
            _retryCount: newRetryCount,
          } as any);
        }
      }

      // Default error handling
      const error = {
        statusCode: response.status,
        statusMessage: response.statusText || 'API request failed',
        data: response._data,
      } as ApiErrorResponse;

      return Promise.reject(error);
    },

    onResponse({ response }) {
      if (process.env['NODE_ENV'] === 'development') {
        console.log('API Response:', response._data);
      }
    },
  });

  // Convenience methods
  const request = async <T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> => {
    try {
      const data = await apiClient(endpoint, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      } as any);

      return data as T;
    } catch (error: any) {
      // If error was already processed by interceptors
      if (error.statusCode) {
        throw error;
      }
      // Handle unexpected errors
      throw {
        statusCode: error.status || 500,
        statusMessage: error?.data?.error || error?.message || 'API request failed',
        data: error?.data,
      } as ApiErrorResponse;
    }
  };

  const get = <T = any>(endpoint: string, options?: ApiOptions): Promise<T> => {
    return request<T>(endpoint, { ...options, method: 'GET' });
  };

  const post = <T = any>(endpoint: string, body?: any, options?: ApiOptions): Promise<T> => {
    return request<T>(endpoint, { ...options, method: 'POST', body });
  };

  const put = <T = any>(endpoint: string, body?: any, options?: ApiOptions): Promise<T> => {
    return request<T>(endpoint, { ...options, method: 'PUT', body });
  };

  const patch = <T = any>(endpoint: string, body?: any, options?: ApiOptions): Promise<T> => {
    return request<T>(endpoint, { ...options, method: 'PATCH', body });
  };

  const del = <T = any>(endpoint: string, options?: ApiOptions): Promise<T> => {
    return request<T>(endpoint, { ...options, method: 'DELETE' });
  };

  // Special method for file uploads
  const upload = async <T = any>(
    endpoint: string,
    formData: FormData,
    options?: ApiOptions,
  ): Promise<T> => {
    const response = await fetch(`${baseURL}${endpoint}`, {
      method: 'POST',
      headers: {
        ...(authStore.accessToken && {
          Authorization: `Bearer ${authStore.accessToken}`,
        }),
        ...(options?.headers as any),
      },
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw {
        statusCode: response.status,
        statusMessage: errorData.error || response.statusText || 'Upload failed',
        data: errorData,
      } as ApiErrorResponse;
    }

    return response.json();
  };

  return {
    request,
    get,
    post,
    put,
    patch,
    delete: del,
    upload,
    baseURL,
  };
};

// Utility function to build query strings
export const buildQueryString = (params: Record<string, any>): string => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
};