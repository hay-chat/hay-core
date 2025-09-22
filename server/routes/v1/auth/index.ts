import { t } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { Organization } from "@server/entities/organization.entity";
import {
  hashPassword,
  verifyPassword,
  generateApiKey,
  hashApiKey,
  generateSessionId,
} from "@server/lib/auth/utils/hashing";
import { generateTokens, verifyRefreshToken, refreshAccessToken } from "@server/lib/auth/utils/jwt";
import { protectedProcedure, publicProcedure, adminProcedure } from "@server/trpc/middleware/auth";
import type { ApiKeyResponse } from "@server/types/auth.types";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    organizationName: z.string().optional(),
    organizationSlug: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const createApiKeySchema = z.object({
  name: z.string().min(1),
  expiresAt: z.date().optional(),
  scopes: z
    .array(
      z.object({
        resource: z.string(),
        actions: z.array(z.string()),
      }),
    )
    .optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const authRouter = t.router({
  // Public endpoints
  login: publicProcedure.input(loginSchema).mutation(async ({ input }) => {
    const { email, password } = input;

    // Find user by email with organization
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { email: email.toLowerCase() },
      relations: ["organization"],
    });

    if (!user) {
      // Prevent timing attacks by using a valid dummy hash
      await verifyPassword(
        password,
        "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$SOWWcWsDNrEh+WTm3Hh5F3hH5KPLz9JRDYbAj2BJUn4",
      );
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password);
    if (!isValidPassword) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Account is deactivated",
      });
    }

    // Update last login time
    user.lastLoginAt = new Date();
    await userRepository.save(user);

    // Generate tokens
    const sessionId = generateSessionId();
    const tokens = generateTokens(user, sessionId);

    // Prepare organization data
    const organizations = user.organization
      ? [
          {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            role: user.role,
          },
        ]
      : [];

    return {
      user: {
        ...user.toJSON(),
        organizations,
        activeOrganizationId: user.organizationId,
      },
      ...tokens,
    };
  }),

  register: publicProcedure.input(registerSchema).mutation(async ({ input }) => {
    const { email, password, firstName, lastName, organizationName, organizationSlug } = input;

    // Use a transaction for atomicity
    return await AppDataSource.transaction(async (manager) => {
      const userRepository = manager.getRepository(User);
      const organizationRepository = manager.getRepository(Organization);

      // Check if user already exists
      const existingUser = await userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      let organization: Organization | null = null;

      // Create organization if name provided
      if (organizationName) {
        const orgSlug =
          organizationSlug ||
          organizationName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "");

        // Check if slug already exists
        const existingOrg = await organizationRepository.findOne({
          where: { slug: orgSlug },
        });

        if (existingOrg) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Organization slug already exists",
          });
        }

        organization = organizationRepository.create({
          name: organizationName,
          slug: orgSlug,
          isActive: true,
          limits: {
            maxUsers: 5,
            maxDocuments: 100,
            maxApiKeys: 10,
            maxJobs: 50,
            maxStorageGb: 1,
          },
        });

        await organizationRepository.save(organization);
      }

      // Hash password
      const hashedPassword = await hashPassword(password, "argon2");

      // Create new user
      const user = userRepository.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        isActive: true,
        organizationId: organization?.id,
        role: organization ? "owner" : "member", // Owner if creating org, otherwise member
      });

      await userRepository.save(user);

      // Generate tokens
      const sessionId = generateSessionId();
      const tokens = generateTokens(user, sessionId);

      // Prepare organization data
      const organizations = organization
        ? [
            {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              role: user.role,
            },
          ]
        : [];

      return {
        user: {
          ...user.toJSON(),
          organizations,
          activeOrganizationId: user.organizationId,
        },
        ...tokens,
      };
    });
  }),

  refreshToken: publicProcedure.input(refreshTokenSchema).mutation(async ({ input }) => {
    try {
      const payload = verifyRefreshToken(input.refreshToken);

      // Find user
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: payload.userId },
      });

      if (!user || !user.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid refresh token",
        });
      }

      // Generate new access token
      const accessToken = await refreshAccessToken(input.refreshToken);

      return {
        accessToken,
        expiresIn: 900, // 15 minutes
      };
    } catch (error) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired refresh token",
      });
    }
  }),

  // Protected endpoints
  me: protectedProcedure.query(async ({ ctx }) => {
    const userEntity = ctx.user!.getUser(); // protectedProcedure guarantees user exists

    // Fetch user with organization data
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: userEntity.id },
      relations: ["organization"],
    });

    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // Prepare organization data
    const organizations = user.organization
      ? [
          {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            role: user.role,
          },
        ]
      : [];

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      authMethod: ctx.user!.authMethod,
      organizations,
      activeOrganizationId: user.organizationId,
      role: user.role,
    };
  }),

  logout: protectedProcedure.mutation(async () => {
    // In a stateless JWT system, logout is handled client-side
    // Here we could invalidate refresh tokens if we're tracking them
    return { success: true };
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: ctx.user!.id },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Verify current password
      const isValidPassword = await verifyPassword(input.currentPassword, user.password);
      if (!isValidPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      user.password = await hashPassword(input.newPassword, "argon2");
      await userRepository.save(user);

      return { success: true };
    }),

  // API Key management
  createApiKey: protectedProcedure
    .input(createApiKeySchema)
    .mutation(async ({ input, ctx }): Promise<ApiKeyResponse> => {
      // Generate API key
      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);

      // Create API key entity
      const apiKeyRepository = AppDataSource.getRepository(ApiKey);
      const apiKeyEntity = apiKeyRepository.create({
        userId: ctx.user!.id,
        keyHash,
        name: input.name,
        expiresAt: input.expiresAt,
        scopes: input.scopes || [],
        isActive: true,
      });

      await apiKeyRepository.save(apiKeyEntity);

      return {
        id: apiKeyEntity.id,
        key: apiKey, // Return the plain key only once
        name: apiKeyEntity.name,
        createdAt: apiKeyEntity.createdAt,
        expiresAt: apiKeyEntity.expiresAt,
        scopes: apiKeyEntity.scopes,
      };
    }),

  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKeys = await apiKeyRepository.find({
      where: { userId: ctx.user!.id, isActive: true },
      select: ["id", "name", "createdAt", "lastUsedAt", "expiresAt", "scopes"],
      order: { createdAt: "DESC" },
    });

    return apiKeys;
  }),

  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const apiKeyRepository = AppDataSource.getRepository(ApiKey);
      const apiKey = await apiKeyRepository.findOne({
        where: { id: input.id, userId: ctx.user!.id },
      });

      if (!apiKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      apiKey.isActive = false;
      await apiKeyRepository.save(apiKey);

      return { success: true };
    }),

  // Admin endpoints
  listUsers: adminProcedure.query(async () => {
    const userRepository = AppDataSource.getRepository(User);
    const users = await userRepository.find({
      select: ["id", "email", "isActive", "createdAt", "lastLoginAt"],
      order: { createdAt: "DESC" },
    });

    return users;
  }),

  deactivateUser: adminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: input.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      user.isActive = false;
      await userRepository.save(user);

      return { success: true };
    }),
});
