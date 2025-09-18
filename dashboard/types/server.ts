// Type declarations for server-side types
// This prevents TypeScript from checking server files

export interface AppRouter {
  auth: {
    login: {
      input: {
        email: string;
        password: string;
      };
      output: {
        accessToken: string;
        refreshToken: string;
        user: {
          id: string;
          email: string;
          firstName?: string;
          lastName?: string;
          isActive: boolean;
          isAdmin: boolean;
          organizationId?: string;
        };
      };
    };
    register: {
      input: {
        email: string;
        password: string;
        confirmPassword: string;
        firstName?: string;
        lastName?: string;
        organizationName?: string;
        organizationSlug?: string;
      };
      output: {
        accessToken: string;
        refreshToken: string;
        user: {
          id: string;
          email: string;
          firstName?: string;
          lastName?: string;
          isActive: boolean;
          isAdmin: boolean;
          organizationId?: string;
        };
      };
    };
    refreshToken: {
      input: {
        refreshToken: string;
      };
      output: {
        accessToken: string;
        refreshToken: string;
      };
    };
    me: {
      input: void;
      output: {
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
        isActive: boolean;
        isAdmin: boolean;
        organizationId?: string;
        organization?: {
          id: string;
          name: string;
          slug: string;
        };
      };
    };
    logout: {
      input: void;
      output: {
        success: boolean;
      };
    };
    updateProfile: {
      input: {
        firstName?: string;
        lastName?: string;
      };
      output: {
        success: boolean;
        user: {
          id: string;
          email: string;
          firstName?: string;
          lastName?: string;
          isActive: boolean;
          isAdmin: boolean;
          organizationId?: string;
        };
      };
    };
    createApiKey: {
      input: {
        name: string;
        expiresAt?: Date;
        scopes?: Array<{
          resource: string;
          actions: string[];
        }>;
      };
      output: {
        id: string;
        name: string;
        key: string;
        createdAt: Date;
        expiresAt?: Date;
        scopes?: Array<{
          resource: string;
          actions: string[];
        }>;
      };
    };
    listApiKeys: {
      input: void;
      output: Array<{
        id: string;
        name: string;
        createdAt: Date;
        expiresAt?: Date;
        lastUsedAt?: Date;
        scopes?: Array<{
          resource: string;
          actions: string[];
        }>;
      }>;
    };
    revokeApiKey: {
      input: {
        id: string;
      };
      output: {
        success: boolean;
      };
    };
    deactivateUser: {
      input: {
        userId: string;
      };
      output: {
        success: boolean;
      };
    };
  };
  documents: {
    list: {
      input: void;
      output: Array<{
        id: string;
        name: string;
        type: string;
        size: number;
        status: string;
        createdAt: Date;
        updatedAt: Date;
      }>;
    };
    create: {
      input: {
        name: string;
        type: string;
        size: number;
        content?: string;
      };
      output: {
        id: string;
        name: string;
        type: string;
        size: number;
        status: string;
        createdAt: Date;
      };
    };
    update: {
      input: {
        id: string;
        name?: string;
        content?: string;
      };
      output: {
        success: boolean;
        document: {
          id: string;
          name: string;
          type: string;
          size: number;
          status: string;
          updatedAt: Date;
        };
      };
    };
    delete: {
      input: {
        id: string;
      };
      output: {
        success: boolean;
      };
    };
  };
}
