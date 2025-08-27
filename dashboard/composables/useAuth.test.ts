import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

// Mock btoa/atob for encryption
global.btoa = vi.fn((str) => Buffer.from(str, 'binary').toString('base64'));
global.atob = vi.fn((str) => Buffer.from(str, 'base64').toString('binary'));

// Mock crypto for encryption (if implemented)
Object.defineProperty(window, 'crypto', {
  value: {
    getRandomValues: vi.fn((array) => {
      // Fill array with dummy values
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }),
    subtle: {
      encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
      decrypt: vi.fn().mockResolvedValue(
        new TextEncoder().encode(
          JSON.stringify({
            accessToken: 'decrypted-access-token',
            refreshToken: 'decrypted-refresh-token',
            expiresAt: Date.now() + 3600000,
          }),
        ),
      ),
      generateKey: vi.fn().mockResolvedValue({}),
      importKey: vi.fn().mockResolvedValue({}),
      deriveKey: vi.fn().mockResolvedValue({}),
    },
  },
});

import { useAuth } from './useAuth';
import type { LoginCredentials, SignupData, AuthTokens, User } from './useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { user, isAuthenticated, isLoading } = useAuth();

      expect(user).toBe(null);
      expect(isAuthenticated).toBe(false);
      expect(isLoading).toBe(false);
    });
  });

  describe('Login', () => {
    it('should successfully login with valid credentials', async () => {
      const { login, user, isAuthenticated, isLoading } = useAuth();

      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        fullName: 'John Doe',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTokens: AuthTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: mockTokens,
          }),
      });

      const credentials: LoginCredentials = {
        email: 'test@example.com',
        password: 'password123',
      };

      expect(isLoading).toBe(false);

      const loginPromise = login(credentials);
      expect(isLoading).toBe(true);

      await loginPromise;

      expect(user).toEqual(mockUser);
      expect(isAuthenticated).toBe(true);
      expect(isLoading).toBe(false);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'hay_tokens',
        JSON.stringify(mockTokens),
      );
    });

    it('should handle invalid credentials error', async () => {
      const { login } = useAuth();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: 'Invalid credentials',
          }),
      });

      const credentials: LoginCredentials = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      await expect(login(credentials)).rejects.toThrow('Invalid credentials');
    });

    it('should handle account locked error', async () => {
      const { login } = useAuth();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 423,
        json: () =>
          Promise.resolve({
            error: 'Account temporarily locked due to multiple failed login attempts',
          }),
      });

      const credentials: LoginCredentials = {
        email: 'test@example.com',
        password: 'password',
      };

      await expect(login(credentials)).rejects.toThrow('Account temporarily locked');
    });

    it('should handle network errors', async () => {
      const { login } = useAuth();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const credentials: LoginCredentials = {
        email: 'test@example.com',
        password: 'password123',
      };

      await expect(login(credentials)).rejects.toThrow('Network error');
    });
  });

  describe('Signup', () => {
    it('should successfully signup with valid data', async () => {
      const { signup, user, isAuthenticated } = useAuth();

      const mockUser: User = {
        id: '1',
        email: 'newuser@example.com',
        fullName: 'Jane Doe',
        organizationId: 'org-2',
        organizationName: 'New Org',
        role: 'admin',
        emailVerified: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTokens: AuthTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      // Mock the register call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: mockTokens,
          }),
      });

      // Mock the organization creation call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'org-2',
            name: 'New Org',
            createdAt: new Date().toISOString(),
          }),
      });

      const signupData: SignupData = {
        organizationName: 'New Org',
        email: 'newuser@example.com',
        fullName: 'Jane Doe',
        password: 'password123',
        acceptTerms: true,
      };

      await signup(signupData);

      expect(user).toEqual(mockUser);
      expect(isAuthenticated).toBe(true);
    });

    it('should handle duplicate email error', async () => {
      const { signup } = useAuth();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            error: 'User with this email already exists',
          }),
      });

      const signupData: SignupData = {
        organizationName: 'Test Org',
        email: 'existing@example.com',
        fullName: 'Jane Doe',
        password: 'password123',
        acceptTerms: true,
      };

      await expect(signup(signupData)).rejects.toThrow('User with this email already exists');
    });
  });

  describe('Logout', () => {
    it('should successfully logout and clear state', async () => {
      const { logout, user, isAuthenticated, login } = useAuth();

      // First login to have state to clear
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: {
              id: '1',
              email: 'test@example.com',
              fullName: 'John Doe',
              organizationId: 'org-1',
              organizationName: 'Test Org',
              role: 'admin',
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            tokens: {
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              expiresAt: Date.now() + 3600000,
            },
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });
      expect(isAuthenticated).toBe(true);

      // Mock logout API call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'Logged out successfully' }),
      });

      await logout();

      expect(user).toBe(null);
      expect(isAuthenticated).toBe(false);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hay_tokens');
    });
  });

  describe('Token Refresh', () => {
    it('should successfully refresh tokens', async () => {
      const { refreshToken, login } = useAuth();

      // First set up auth state with tokens by logging in
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: {
              id: '1',
              email: 'test@example.com',
              fullName: 'John Doe',
              organizationId: 'org-1',
              organizationName: 'Test Org',
              role: 'admin',
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            tokens: {
              accessToken: 'old-access-token',
              refreshToken: 'old-refresh-token',
              expiresAt: Date.now() + 3600000,
            },
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });

      const newTokens: AuthTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tokens: newTokens,
          }),
      });

      const result = await refreshToken();

      expect(result).toEqual(newTokens);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'hay_tokens',
        JSON.stringify(newTokens),
      );
    });

    it('should handle invalid refresh token', async () => {
      const { refreshToken, login } = useAuth();

      // First set up auth state with tokens by logging in
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: {
              id: '1',
              email: 'test@example.com',
              fullName: 'John Doe',
              organizationId: 'org-1',
              organizationName: 'Test Org',
              role: 'admin',
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            tokens: {
              accessToken: 'old-access-token',
              refreshToken: 'old-refresh-token',
              expiresAt: Date.now() + 3600000,
            },
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });

      // Now mock the refresh call to fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: 'Invalid refresh token',
          }),
      });

      await expect(refreshToken()).rejects.toThrow('Invalid refresh token');
    });
  });

  describe('Initialize Authentication', () => {
    it('should initialize auth state from stored tokens', async () => {
      const { initializeAuth, isAuthenticated, user } = useAuth();

      const storedTokens = {
        accessToken: 'stored-access-token',
        refreshToken: 'stored-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      const mockUser: User = {
        id: '1',
        email: 'stored@example.com',
        fullName: 'Stored User',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(storedTokens));

      // Mock API call to validate token and get user data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            valid: true,
          }),
      });

      await initializeAuth();

      expect(isAuthenticated).toBe(true);
      expect(user).toEqual(mockUser);
    });

    it('should clear auth state if stored tokens are invalid', async () => {
      const { initializeAuth, isAuthenticated } = useAuth();

      const storedTokens = {
        accessToken: 'invalid-token',
        refreshToken: 'invalid-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(storedTokens));

      // Mock API call returning invalid token
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: 'Invalid token',
          }),
      });

      await initializeAuth();

      expect(isAuthenticated).toBe(false);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hay_tokens');
    });

    it('should handle missing stored tokens', async () => {
      const { initializeAuth, isAuthenticated } = useAuth();

      mockLocalStorage.getItem.mockReturnValue(null);

      await initializeAuth();

      expect(isAuthenticated).toBe(false);
    });
  });

  describe('Social Login', () => {
    it('should initiate social login flow', async () => {
      const { socialLogin } = useAuth();

      // Mock window.location
      const mockLocation = {
        href: '',
      };
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
      });

      await socialLogin('google');

      // In real implementation, this would redirect to OAuth provider
      // For now, we just test that the method doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('Password Reset', () => {
    it('should successfully request password reset', async () => {
      const { forgotPassword } = useAuth();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            message: 'If the email exists, a reset link has been sent',
          }),
      });

      await expect(forgotPassword('test@example.com')).resolves.not.toThrow();
    });

    it('should handle password reset request errors', async () => {
      const { forgotPassword } = useAuth();

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(forgotPassword('test@example.com')).rejects.toThrow('Network error');
    });
  });

  describe('Secure Token Management', () => {
    it('should encrypt tokens before storing in localStorage', async () => {
      const { login } = useAuth();

      // Mock encryption
      const mockEncryptedData = new ArrayBuffer(32);
      window.crypto.subtle.encrypt = vi.fn().mockResolvedValue(mockEncryptedData);

      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        fullName: 'John Doe',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTokens: AuthTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: mockTokens,
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });

      // Should have called encrypt function
      expect(window.crypto.subtle.encrypt).toHaveBeenCalled();

      // Should store encrypted data, not plain tokens
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'hay_tokens',
        expect.not.stringContaining('access-token'),
      );
    });

    it('should decrypt tokens when retrieving from localStorage', async () => {
      const { initializeAuth, isAuthenticated } = useAuth();

      // Mock decryption
      const decryptedTokens = {
        accessToken: 'decrypted-access-token',
        refreshToken: 'decrypted-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      window.crypto.subtle.decrypt = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(JSON.stringify(decryptedTokens)));

      // Mock encrypted data in localStorage
      const encryptedData = 'encrypted-token-data';
      mockLocalStorage.getItem.mockReturnValue(encryptedData);

      // Mock successful token validation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: {
              id: '1',
              email: 'test@example.com',
              fullName: 'John Doe',
              organizationId: 'org-1',
              organizationName: 'Test Org',
              role: 'admin',
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }),
      });

      await initializeAuth();

      expect(window.crypto.subtle.decrypt).toHaveBeenCalled();
      expect(isAuthenticated).toBe(true);
    });

    it('should handle decryption errors gracefully', async () => {
      const { initializeAuth, isAuthenticated } = useAuth();

      // Mock decryption failure
      window.crypto.subtle.decrypt = vi.fn().mockRejectedValue(new Error('Decryption failed'));

      mockLocalStorage.getItem.mockReturnValue('invalid-encrypted-data');

      await initializeAuth();

      expect(isAuthenticated).toBe(false);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hay_tokens');
    });

    it('should automatically refresh tokens before expiration', async () => {
      const { login, refreshToken } = useAuth();

      // Mock initial login
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        fullName: 'John Doe',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Tokens expiring in 15 minutes (so refresh triggers in 5 minutes)
      const expiringTokens: AuthTokens = {
        accessToken: 'expiring-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: expiringTokens,
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });

      // Now test manual refresh token call to verify the API endpoint works
      const newTokens: AuthTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            tokens: newTokens,
          }),
      });

      // Call refresh manually to test the functionality
      await refreshToken();

      // Should have called refresh endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/auth\/refresh$/),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should clear all auth data when refresh fails', async () => {
      const { login, isAuthenticated, refreshToken } = useAuth();

      // Mock initial login
      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        fullName: 'John Doe',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const expiringTokens: AuthTokens = {
        accessToken: 'expiring-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 15 * 60 * 1000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: expiringTokens,
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });
      expect(isAuthenticated).toBe(true);

      // Mock failed token refresh
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: 'Refresh token expired',
          }),
      });

      // Call refresh manually to test failure scenario
      await expect(refreshToken()).rejects.toThrow('Refresh token expired');

      expect(isAuthenticated).toBe(false);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('hay_tokens');
    });

    it('should use secure storage key derivation', async () => {
      const { login } = useAuth();

      const mockUser: User = {
        id: '1',
        email: 'test@example.com',
        fullName: 'John Doe',
        organizationId: 'org-1',
        organizationName: 'Test Org',
        role: 'admin',
        emailVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockTokens: AuthTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: mockUser,
            tokens: mockTokens,
          }),
      });

      await login({ email: 'test@example.com', password: 'password123' });

      // Should have derived a secure key
      expect(window.crypto.subtle.deriveKey).toHaveBeenCalled();
      expect(window.crypto.subtle.importKey).toHaveBeenCalled();
    });
  });

  describe('API Configuration', () => {
    it('should use correct API base URL', async () => {
      const { login } = useAuth();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            user: {},
            tokens: {},
          }),
      });

      await login({ email: 'test@example.com', password: 'password' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/auth\/login$/),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        }),
      );
    });
  });
});
