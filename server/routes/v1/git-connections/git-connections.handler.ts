import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authenticatedProcedure } from "@server/trpc";
import { gitConnectionService } from "@server/services/git-connection.service";

/**
 * Get the GitHub App installation URL (or null if not configured).
 */
export const getInstallUrl = authenticatedProcedure.query(async ({ ctx }) => {
  const url = await gitConnectionService.initiateInstall(ctx.organizationId!, ctx.user!.id);
  return { url, configured: gitConnectionService.isGitHubConfigured() };
});

/**
 * Complete a GitHub App installation.
 * Called by the frontend after GitHub redirects back with installation_id.
 */
export const completeInstallation = authenticatedProcedure
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
      const message = error instanceof Error ? error.message : "Installation failed";
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
  });

/**
 * List all git connections for the organization.
 */
export const listConnections = authenticatedProcedure.query(async ({ ctx }) => {
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
export const removeConnection = authenticatedProcedure
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
export const listRepos = authenticatedProcedure
  .input(z.object({ connectionId: z.string().uuid() }))
  .query(async ({ input, ctx }) => {
    try {
      const repos = await gitConnectionService.listAvailableRepos(
        input.connectionId,
        ctx.organizationId!,
      );
      return repos;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list repos";
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  });

/**
 * Install a plugin from a git repo.
 */
export const installPlugin = authenticatedProcedure
  .input(
    z.object({
      connectionId: z.string().uuid(),
      repoFullName: z.string().min(1),
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
      const message = error instanceof Error ? error.message : "Failed to install plugin";
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
  });

/**
 * Manually trigger sync for a git-sourced plugin.
 */
export const syncPlugin = authenticatedProcedure
  .input(z.object({ pluginId: z.string().min(1) }))
  .mutation(async ({ input }) => {
    try {
      const result = await gitConnectionService.syncPlugin(input.pluginId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  });

/**
 * Check if a git-sourced plugin has updates.
 */
export const checkForUpdates = authenticatedProcedure
  .input(z.object({ pluginId: z.string().min(1) }))
  .query(async ({ input }) => {
    try {
      return await gitConnectionService.checkForUpdates(input.pluginId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check failed";
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }
  });
