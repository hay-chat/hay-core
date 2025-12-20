import { AppDataSource } from "../../server/database/data-source";
import { User } from "../../server/entities/user.entity";
import { Organization } from "../../server/entities/organization.entity";
import { UserOrganization } from "../../server/entities/user-organization.entity";
import { generateTokens } from "../../server/lib/auth/utils/jwt";
import { hashPassword } from "../../server/lib/auth/utils/hashing";
import { Like } from "typeorm";

// Constants
export const TEST_USER_EMAIL_PATTERN = "hay-e2e-%@test.com";
export const TEST_PASSWORD = "E2eTest@123456";

/**
 * Generate test user email based on current date
 * Format: hay-e2e-YYYYMMDD@test.com
 */
export function getTestUserEmail(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `hay-e2e-${date}@test.com`;
}

/**
 * Generate test organization name based on current date
 * Format: E2E Test Org YYYYMMDD
 */
export function getTestOrgName(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `E2E Test Org ${date}`;
}

/**
 * Delete all test users matching the pattern
 */
export async function cleanupTestUsers(): Promise<void> {
  const userRepository = AppDataSource.getRepository(User);
  const orgRepository = AppDataSource.getRepository(Organization);

  const testUsers = await userRepository.find({
    where: {
      email: Like(TEST_USER_EMAIL_PATTERN),
    },
  });

  if (testUsers.length > 0) {
    // Delete organizations
    const orgIds = testUsers
      .map((u) => u.organizationId)
      .filter((id) => id) as string[];

    if (orgIds.length > 0) {
      await orgRepository.delete(orgIds);
    }

    // Delete users (CASCADE will handle UserOrganization)
    await userRepository.remove(testUsers);
  }
}

/**
 * Create test user with organization
 * Returns user, organization, and tokens
 */
export async function createTestUser(): Promise<{
  user: User;
  organization: Organization;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}> {
  const testEmail = getTestUserEmail();
  const testOrgName = getTestOrgName();

  const result = await AppDataSource.transaction(async (manager) => {
    const userRepo = manager.getRepository(User);
    const orgRepo = manager.getRepository(Organization);
    const userOrgRepo = manager.getRepository(UserOrganization);

    // Create organization
    const organization = orgRepo.create({
      name: testOrgName,
      slug: `e2e-test-${Date.now()}`,
      isActive: true,
      limits: {
        maxUsers: 5,
        maxDocuments: 100,
        maxApiKeys: 10,
        maxJobs: 50,
        maxStorageGb: 1,
      },
    });
    await orgRepo.save(organization);

    // Create user
    const hashedPassword = await hashPassword(TEST_PASSWORD, "argon2");
    const user = userRepo.create({
      email: testEmail,
      password: hashedPassword,
      firstName: "E2E",
      lastName: "Test User",
      isActive: true,
      organizationId: organization.id,
      role: "owner",
    });
    user.updateLastSeen();
    await userRepo.save(user);

    // Create UserOrganization
    const userOrg = userOrgRepo.create({
      userId: user.id,
      organizationId: organization.id,
      role: "owner",
      isActive: true,
      joinedAt: new Date(),
    });
    await userOrgRepo.save(userOrg);

    return { user, organization };
  });

  // Generate tokens
  const tokens = generateTokens(result.user);

  return {
    user: result.user,
    organization: result.organization,
    tokens,
  };
}

/**
 * Generate Playwright storage state from tokens and user
 */
export function generateAuthState(
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  user: User,
  organization: Organization,
): object {
  return {
    cookies: [],
    origins: [
      {
        origin: "http://localhost:3000",
        localStorage: [
          {
            name: "pinia:auth",
            value: JSON.stringify({
              tokens: {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: Date.now() + tokens.expiresIn * 1000,
              },
              isAuthenticated: true,
              isInitialized: true,
              lastActivity: Date.now(),
              isLoading: false,
            }),
          },
          {
            name: "pinia:user",
            value: JSON.stringify({
              user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                isActive: user.isActive,
                role: user.role,
                organizations: [
                  {
                    id: organization.id,
                    name: organization.name,
                    slug: organization.slug,
                    role: "owner",
                    joinedAt: new Date().toISOString(),
                  },
                ],
                activeOrganizationId: organization.id,
              },
            }),
          },
        ],
      },
    ],
  };
}
