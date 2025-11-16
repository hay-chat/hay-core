import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { ApiKey } from "@server/entities/apikey.entity";
import { generateApiKey, hashApiKey } from "@server/lib/auth/utils/hashing";
import { ApiTokenScope } from "@server/types/api-token-scopes";
import { RESOURCES, ACTIONS } from "@server/types/scopes";

// Schema for creating an API token
const createApiTokenSchema = z.object({
  name: z.string().min(1, "Token name is required").max(255),
  scopes: z.array(z.nativeEnum(ApiTokenScope)).optional().default([]),
  expiresAt: z.date().optional(),
});

// Schema for updating an API token
const updateApiTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  scopes: z.array(z.nativeEnum(ApiTokenScope)).optional(),
});

// Schema for revoking/deleting an API token
const tokenIdSchema = z.object({
  id: z.string().uuid(),
});

export const apiTokensRouter = t.router({
  /**
   * Create a new API token
   * Returns the plain token ONLY ONCE
   */
  create: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.CREATE).input(createApiTokenSchema).mutation(async ({ input, ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    // Generate the API token
    const token = generateApiKey();
    const tokenHash = await hashApiKey(token);

    // Convert scopes to the ApiKeyScope format (resource/actions pairs)
    const scopesFormatted = input.scopes.map((scope) => {
      const [resource, action] = scope.split(":");
      return {
        resource: resource || "*",
        actions: action ? [action] : ["*"],
      };
    });

    // Create the API key entity
    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKeyEntity = apiKeyRepository.create({
      organizationId: ctx.organizationId,
      keyHash: tokenHash,
      name: input.name,
      scopes: scopesFormatted,
      expiresAt: input.expiresAt,
      isActive: true,
    });

    await apiKeyRepository.save(apiKeyEntity);

    return {
      id: apiKeyEntity.id,
      token, // Return plain token ONLY ONCE
      name: apiKeyEntity.name,
      scopes: input.scopes,
      createdAt: apiKeyEntity.createdAt,
      expiresAt: apiKeyEntity.expiresAt,
    };
  }),

  /**
   * List all API tokens for the current organization
   * Returns masked keys (never shows full token again)
   */
  list: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.READ).query(async ({ ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKeys = await apiKeyRepository.find({
      where: { organizationId: ctx.organizationId },
      order: { createdAt: "DESC" },
    });

    // Return tokens with masked keys
    return apiKeys.map((key) => {
      // Extract last 4 characters of the hash for display
      const last4 = key.keyHash.slice(-4);

      // Flatten scopes back to string array
      const scopeStrings = key.scopes.map((scope) => {
        if (scope.actions.includes("*")) {
          return `${scope.resource}:*`;
        }
        return scope.actions.map((action) => `${scope.resource}:${action}`).join(",");
      });

      return {
        id: key.id,
        name: key.name,
        maskedKey: `hay_****${last4}`,
        scopes: scopeStrings,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        isActive: key.isActive,
      };
    });
  }),

  /**
   * Update an API token (name and scopes only)
   */
  update: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.UPDATE).input(updateApiTokenSchema).mutation(async ({ input, ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepository.findOne({
      where: {
        id: input.id,
        organizationId: ctx.organizationId,
      },
    });

    if (!apiKey) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "API token not found",
      });
    }

    // Update name if provided
    if (input.name !== undefined) {
      apiKey.name = input.name;
    }

    // Update scopes if provided
    if (input.scopes !== undefined) {
      apiKey.scopes = input.scopes.map((scope) => {
        const [resource, action] = scope.split(":");
        return {
          resource: resource || "*",
          actions: action ? [action] : ["*"],
        };
      });
    }

    await apiKeyRepository.save(apiKey);

    return {
      success: true,
      token: {
        id: apiKey.id,
        name: apiKey.name,
        scopes: input.scopes,
      },
    };
  }),

  /**
   * Revoke an API token (soft delete - sets isActive to false)
   */
  revoke: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.DELETE).input(tokenIdSchema).mutation(async ({ input, ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepository.findOne({
      where: {
        id: input.id,
        organizationId: ctx.organizationId,
      },
    });

    if (!apiKey) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "API token not found",
      });
    }

    apiKey.isActive = false;
    await apiKeyRepository.save(apiKey);

    return {
      success: true,
      message: "API token revoked successfully",
    };
  }),

  /**
   * Permanently delete an API token
   */
  delete: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.DELETE).input(tokenIdSchema).mutation(async ({ input, ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepository.findOne({
      where: {
        id: input.id,
        organizationId: ctx.organizationId,
      },
    });

    if (!apiKey) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "API token not found",
      });
    }

    await apiKeyRepository.remove(apiKey);

    return {
      success: true,
      message: "API token deleted successfully",
    };
  }),

  /**
   * Get a single API token by ID
   */
  getById: scopedProcedure(RESOURCES.API_KEYS, ACTIONS.READ).input(tokenIdSchema).query(async ({ input, ctx }) => {
    if (!ctx.organizationId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Organization ID is required",
      });
    }

    const apiKeyRepository = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepository.findOne({
      where: {
        id: input.id,
        organizationId: ctx.organizationId,
      },
    });

    if (!apiKey) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "API token not found",
      });
    }

    // Extract last 4 characters for masking
    const last4 = apiKey.keyHash.slice(-4);

    // Flatten scopes to string array
    const scopeStrings = apiKey.scopes.map((scope) => {
      if (scope.actions.includes("*")) {
        return `${scope.resource}:*`;
      }
      return scope.actions.map((action) => `${scope.resource}:${action}`).join(",");
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      maskedKey: `hay_****${last4}`,
      scopes: scopeStrings,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      expiresAt: apiKey.expiresAt,
      isActive: apiKey.isActive,
    };
  }),
});
