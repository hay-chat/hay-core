// Generated types from server API
// This file should be auto-generated in production

export interface User {
  id: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ApiKeyResponse {
  id: string;
  key: string;
  name: string;
  createdAt: Date;
  expiresAt?: Date;
  scopes?: Array<{
    resource: string;
    actions: string[];
  }>;
}

export type AppRouter = {
  auth: {
    login: {
      mutate: (input: { email: string; password: string }) => Promise<AuthResponse>;
    };
    register: {
      mutate: (input: { email: string; password: string; confirmPassword: string }) => Promise<AuthResponse>;
    };
    refreshToken: {
      mutate: (input: { refreshToken: string }) => Promise<{ accessToken: string; expiresIn: number }>;
    };
    me: {
      query: () => Promise<{
        id: string;
        email: string;
        isActive: boolean;
        lastLoginAt: Date | null;
        authMethod: string;
      }>;
    };
    logout: {
      mutate: () => Promise<{ success: boolean }>;
    };
    changePassword: {
      mutate: (input: { currentPassword: string; newPassword: string }) => Promise<{ success: boolean }>;
    };
    createApiKey: {
      mutate: (input: {
        name: string;
        expiresAt?: Date;
        scopes?: Array<{ resource: string; actions: string[] }>;
      }) => Promise<ApiKeyResponse>;
    };
    listApiKeys: {
      query: () => Promise<Array<{
        id: string;
        name: string;
        createdAt: Date;
        lastUsedAt?: Date;
        expiresAt?: Date;
        scopes?: Array<{ resource: string; actions: string[] }>;
      }>>;
    };
    revokeApiKey: {
      mutate: (input: { id: string }) => Promise<{ success: boolean }>;
    };
  };
  documents: {
    list: {
      query: () => Promise<any[]>;
    };
    create: {
      mutate: (input: { name: string; content: string }) => Promise<any>;
    };
    update: {
      mutate: (input: { id: string; name: string; content: string }) => Promise<any>;
    };
    delete: {
      mutate: (input: { id: string }) => Promise<any>;
    };
  };
};