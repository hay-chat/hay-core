import { z } from "zod";
import { scopedProcedure } from "@server/trpc";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { gitConnectionService } from "@server/services/git-connection.service";
import { toClientError } from "@server/trpc/client-error";

/** Git connections install plugin code, so every procedure needs plugin-manage access. */
const gitManageProcedure = scopedProcedure(RESOURCES.PLUGINS, ACTIONS.MANAGE);

/**
 * Get the GitHub App installation URL (or null if not configured).
 */
export const getInstallUrl = gitManageProcedure.query(async ({ ctx }) => {
  const url = await gitConnectionService.initiateInstall(ctx.organizationId!, ctx.user!.id);
  return { url, configured: gitConnectionService.isGitHubConfigured() };
});

/**
 * Complete a GitHub App installation.
 * Called by the frontend after GitHub redirects back with installation_id.
 */
export const completeInstallation = gitManageProcedure
  .input(
    z.object({
      installationId: z.string().min(1),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const connection = await gitConnectionService.handleInstallation(
        input.installationId,
        ctx.organizationId!,
        ctx.user!.id,
      );
      return {
        success: true,
        connectionId: connection.id,
        accountLogin: connection.accountLogin,
      };
    } catch (error) {
      throw toClientError(error, "BAD_REQUEST", "Installation failed");
    }
  });

/**
 * List all git connections for the organization.
 */
export const listConnections = gitManageProcedure.query(async ({ ctx }) => {
  const connections = await gitConnectionService.listConnections(ctx.organizationId!);
  return connections.map((c) => ({
    id: c.id,
    provider: c.provider,
    installationId: c.installationId,
    accountLogin: c.accountLogin,
    accountType: c.accountType,
    repositorySelection: c.repositorySelection,
    status: c.status,
    lastSyncAt: c.lastSyncAt,
    lastSyncError: c.lastSyncError,
    createdAt: c.createdAt,
  }));
});

/**
 * Remove a git connection.
 */
export const removeConnection = gitManageProcedure
  .input(
    z.object({
      connectionId: z.string().uuid(),
      removePlugins: z.boolean().default(false),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    await gitConnectionService.removeConnection(
      input.connectionId,
      ctx.organizationId!,
      input.removePlugins,
    );
    return { success: true };
  });

/**
 * List repos available from a git connection.
 */
export const listRepos = gitManageProcedure
  .input(z.object({ connectionId: z.string().uuid() }))
  .query(async ({ input, ctx }) => {
    try {
      const repos = await gitConnectionService.listAvailableRepos(
        input.connectionId,
        ctx.organizationId!,
      );
      return repos;
    } catch (error) {
      throw toClientError(error, "INTERNAL_SERVER_ERROR", "Failed to list repos");
    }
  });

/**
 * Install a plugin from a git repo.
 */
export const installPlugin = gitManageProcedure
  .input(
    z.object({
      connectionId: z.string().uuid(),
      repoFullName: z
        .string()
        .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Invalid repository name"),
      branch: z.string().optional(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const plugin = await gitConnectionService.installPluginFromRepo({
        connectionId: input.connectionId,
        organizationId: ctx.organizationId!,
        repoFullName: input.repoFullName,
        branch: input.branch,
        userId: ctx.user!.id,
      });

      return {
        success: true,
        pluginId: plugin.pluginId,
        name: plugin.name,
        version: plugin.version,
        commitSha: plugin.gitLastCommitSha,
      };
    } catch (error) {
      throw toClientError(error, "BAD_REQUEST", "Failed to install plugin");
    }
  });

/**
 * Apply the latest commit of a git-sourced plugin's branch (explicit admin action).
 */
export const syncPlugin = gitManageProcedure
  .input(z.object({ pluginId: z.string().min(1) }))
  .mutation(async ({ input, ctx }) => {
    try {
      const result = await gitConnectionService.syncPlugin(input.pluginId, ctx.organizationId!);
      return result;
    } catch (error) {
      throw toClientError(error, "INTERNAL_SERVER_ERROR", "Sync failed");
    }
  });

/**
 * Check if a git-sourced plugin has updates.
 */
export const checkForUpdates = gitManageProcedure
  .input(z.object({ pluginId: z.string().min(1) }))
  .query(async ({ input, ctx }) => {
    try {
      return await gitConnectionService.checkForUpdates(input.pluginId, ctx.organizationId!);
    } catch (error) {
      throw toClientError(error, "INTERNAL_SERVER_ERROR", "Check failed");
    }
  });
