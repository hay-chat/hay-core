import { t } from "@/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@/database/data-source";
import { User } from "@/entities/user.entity";
import { ApiKey } from "@/entities/apikey.entity";
import {
  hashPassword,
  verifyPassword,
  generateApiKey,
  hashApiKey,
  generateSessionId,
} from "@/lib/auth/utils/hashing";
import {
  generateTokens,
  verifyRefreshToken,
  refreshAccessToken,
} from "@/lib/auth/utils/jwt";
import {
  protectedProcedure,
  publicProcedure,
  adminProcedure,
} from "@/trpc/middleware/auth";
import { ApiKeyResponse } from "@/types/auth.types";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const registerSchema = z
  .object({
    email: z.email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
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
      })
    )
    .optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const authRouter = t.router({
  // Public endpoints
  login: publicProcedure.input(loginSchema).mutation(async ({ input, ctx }) => {
    const { email, password } = input;

    // Find user by email
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Prevent timing attacks by using a valid dummy hash
      await verifyPassword(
        password,
        "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$SOWWcWsDNrEh+WTm3Hh5F3hH5KPLz9JRDYbAj2BJUn4"
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

    return {
      user: user.toJSON(),
      ...tokens,
    };
  }),

  register: publicProcedure
    .input(registerSchema)
    .mutation(async ({ input }) => {
      const { email, password } = input;

      const userRepository = AppDataSource.getRepository(User);

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

      // Hash password
      const hashedPassword = await hashPassword(password, "argon2");

      // Create new user
      const user = userRepository.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        isActive: true,
      });

      await userRepository.save(user);

      // Generate tokens
      const sessionId = generateSessionId();
      const tokens = generateTokens(user, sessionId);

      return {
        user: user.toJSON(),
        ...tokens,
      };
    }),

  refreshToken: publicProcedure
    .input(refreshTokenSchema)
    .mutation(async ({ input }) => {
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
    const user = ctx.user!.getUser(); // protectedProcedure guarantees user exists
    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      authMethod: ctx.user!.authMethod,
    };
  }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    // In a stateless JWT system, logout is handled client-side
    // Here we could invalidate refresh tokens if we're tracking them
    return { success: true };
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(8),
      })
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
      const isValidPassword = await verifyPassword(
        input.currentPassword,
        user.password
      );
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
