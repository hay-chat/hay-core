// Simple API client for tRPC endpoints
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

async function callTRPC(path: string, input: any = undefined, token?: string) {
  const url = `${getApiBaseUrl()}/v1/${path}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const options: RequestInit = {
    method: input !== undefined ? 'POST' : 'GET',
    headers,
  };
  
  if (input !== undefined) {
    options.body = JSON.stringify(input);
  }
  
  const response = await fetch(url, options);
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || 'API Error');
  }
  
  return data.result?.data;
}

export const apiClient = {
  auth: {
    login: {
      mutate: (input: { email: string; password: string }) => 
        callTRPC('auth.login', input),
    },
    register: {
      mutate: (input: { email: string; password: string; confirmPassword: string }) =>
        callTRPC('auth.register', input),
    },
    refreshToken: {
      mutate: (input: { refreshToken: string }) =>
        callTRPC('auth.refreshToken', input),
    },
    me: {
      query: (token?: string) => callTRPC('auth.me', undefined, token),
    },
    logout: {
      mutate: (token?: string) => callTRPC('auth.logout', {}, token),
    },
  },
};