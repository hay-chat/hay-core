import { User } from '@/entities/user.entity';
import { AuthUser } from '@/lib/auth/AuthUser';
import { parseBasicAuth, verifyPassword } from '@/lib/auth/utils/hashing';
import { generateTokens } from '@/lib/auth/utils/jwt';
import { AppDataSource } from '@/database/data-source';

export interface BasicAuthResult {
  user: AuthUser;
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

/**
 * Authenticate a user using Basic Authentication (email:password)
 * Returns both the authenticated user and JWT tokens
 */
export async function authenticateBasicAuth(authHeader?: string): Promise<BasicAuthResult | null> {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const credentials = parseBasicAuth(authHeader);
  if (!credentials) {
    throw new Error('Invalid Basic Auth credentials format');
  }

  const { email, password } = credentials;
  
  // Find user by email
  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    // Prevent timing attacks by still running password verification
    await verifyPassword(password, '$argon2id$v=19$m=65536,t=3,p=4$fakesalt$fakehash');
    throw new Error('Invalid credentials');
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password);
  if (!isValidPassword) {
    throw new Error('Invalid credentials');
  }

  // Check if user is active
  if (!user.isActive) {
    throw new Error('Account is deactivated');
  }

  // Update last login time
  user.lastLoginAt = new Date();
  await userRepository.save(user);

  // Generate JWT tokens
  const tokens = generateTokens(user);

  // Create AuthUser instance
  const authUser = new AuthUser(user, 'basic', {
    sessionId: `basic_${Date.now()}_${Math.random().toString(36).substring(2)}`,
  });

  return {
    user: authUser,
    tokens,
  };
}

/**
 * Validate Basic Auth credentials without generating tokens
 * Used for one-time authentication checks
 */
export async function validateBasicAuth(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const credentials = parseBasicAuth(authHeader);
  if (!credentials) {
    return null;
  }

  const { email, password } = credentials;
  
  // Find user by email
  const userRepository = AppDataSource.getRepository(User);
  const user = await userRepository.findOne({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    return null;
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password);
  if (!isValidPassword) {
    return null;
  }

  // Check if user is active
  if (!user.isActive) {
    return null;
  }

  // Create AuthUser instance
  return new AuthUser(user, 'basic');
}