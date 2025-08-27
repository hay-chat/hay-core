import { useAuthStore } from '~/stores/auth';
import { useUserStore } from '~/stores/user';

export interface User {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  organizationName: string;
  role: 'admin' | 'user';
  avatar?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface SignupData {
  organizationName: string;
  email: string;
  fullName: string;
  password: string;
  acceptTerms: boolean;
  acceptMarketing?: boolean;
}

export interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Simplified composable that acts as a wrapper around the Pinia stores
// This provides a clean API while delegating all logic to the stores

export function useAuth() {
  const authStore = useAuthStore();
  const userStore = useUserStore();

  // Login method - delegates to store
  const login = async (credentials: LoginCredentials): Promise<void> => {
    await authStore.login(credentials);
    // Initialize user data after successful login
    if (authStore.isAuthenticated) {
      await userStore.initializeUserData();
    }
  };

  // Signup method - delegates to store
  const signup = async (data: SignupData): Promise<void> => {
    await authStore.signup(data);
    // Initialize user data after successful signup
    if (authStore.isAuthenticated) {
      await userStore.initializeUserData();
    }
  };

  // Logout method - delegates to store
  const logout = async (): Promise<void> => {
    await authStore.logout();
    // Clear user data
    userStore.clearUserData();
  };

  // Refresh token method - delegates to store
  const refreshToken = async (): Promise<AuthTokens> => {
    return await authStore.refreshToken();
  };

  // Forgot password method - delegates to store
  const forgotPassword = async (email: string): Promise<void> => {
    await authStore.forgotPassword(email);
  };

  // Social login method - delegates to store
  const socialLogin = async (provider: string): Promise<void> => {
    await authStore.socialLogin(provider);
  };

  // Initialize auth method - delegates to store
  const initializeAuth = async (): Promise<void> => {
    await authStore.initializeAuth();
    if (authStore.isAuthenticated) {
      await userStore.initializeUserData();
    }
  };

  return {
    // State - directly from stores
    user: authStore.user,
    isAuthenticated: authStore.isAuthenticated,
    isLoading: authStore.isLoading,
    error: authStore.error,

    // Methods
    login,
    signup,
    logout,
    refreshToken,
    forgotPassword,
    socialLogin,
    initializeAuth,
  };
}

// Export helpers to get stores directly when needed
export function getAuthStore() {
  return useAuthStore();
}

export function getUserStore() {
  return useUserStore();
}
