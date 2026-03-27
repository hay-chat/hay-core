import path from "path";
import fs from "fs/promises";
import { config, getDashboardUrl } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { gitConnectionRepository } from "@server/repositories/git-connection.repository";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { oauthStateService } from "./oauth-state.service";
import { GitHubProvider } from "@server/lib/git/github-provider";
import { extractTarball, validateTarball } from "@server/lib/git/tarball";
import type { GitProvider, GitRepoInfo } from "@server/lib/git/git-provider.interface";
import type { GitConnection } from "@server/entities/git-connection.entity";
import type { PluginRegistry } from "@server/entities/plugin-registry.entity";
import { AppDataSource } from "@server/database/data-source";

const logger = createLogger("git-connection");

export class GitConnectionService {
  private providers: Map<string, GitProvider> = new Map();
  private pluginsDir: string;

  constructor() {
    this.pluginsDir = path.join(process.cwd(), "..", "plugins");
    // Register providers
    this.providers.set("github", new GitHubProvider());
  }

  private getProvider(providerId: string): GitProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Git provider "${providerId}" is not supported`);
    }
    return provider;
  }

  /**
   * Check if GitHub App is configured
   */
  isGitHubConfigured(): boolean {
    return !!config.github.appId && !!config.github.appPrivateKey;
  }

  /**
   * Get the GitHub App installation URL.
   * Returns null if the GitHub App is not configured.
   */
  getInstallUrl(organizationId: string, userId: string): string | null {
    if (!this.isGitHubConfigured()) {
      return null;
    }

    const { appName } = config.github;
    if (!appName) {
      logger.warn("GITHUB_APP_NAME not configured, cannot generate install URL");
      return null;
    }

    // State parameter will be stored in Redis when the user initiates the flow
    return `https://github.com/apps/${appName}/installations/new`;
  }

  /**
   * Generate a state parameter and store it in Redis for the GitHub App install flow.
   * Returns the full redirect URL including state.
   */
  async initiateInstall(organizationId: string, userId: string): Promise<string | null> {
    if (!this.isGitHubConfigured() || !config.github.appName) {
      return null;
    }

    const nonce = oauthStateService.generateNonce();

    await oauthStateService.storeState({
      pluginId: "github-app-install", // Not a real plugin, just for state tracking
      organizationId,
      userId,
      nonce,
      createdAt: Date.now(),
    });

    return `https://github.com/apps/${config.github.appName}/installations/new?state=${nonce}`;
  }

  /**
   * Complete a GitHub App installation.
   * Called from the authenticated tRPC endpoint after GitHub redirects back to the dashboard.
   */
  async handleInstallation(
    installationId: string,
    organizationId: string,
    userId: string,
  ): Promise<GitConnection> {
    // Check if this installation is already connected
    const existing = await gitConnectionRepository.findByInstallationId("github", installationId);
    if (existing) {
      if (existing.organizationId === organizationId) {
        logger.info({ installationId }, "GitHub installation already connected to this org");
        return existing;
      }
      throw new Error("This GitHub installation is already connected to another organization");
    }

    // Fetch installation details from GitHub
    const githubProvider = this.getProvider("github") as GitHubProvider;
    const installationDetails = await githubProvider.getInstallation(installationId);

    // Create the connection
    const connection = await gitConnectionRepository.createConnection({
      organizationId,
      provider: "github",
      installationId,
      accountLogin: installationDetails.account.login,
      accountType: installationDetails.account.type,
      permissions: installationDetails.permissions,
      repositorySelection: installationDetails.repositorySelection,
      installedById: userId,
      status: "active",
    });

    logger.info(
      { connectionId: connection.id, accountLogin: connection.accountLogin, organizationId },
      "GitHub App installation connected",
    );

    return connection;
  }

  /**
   * List all git connections for an organization.
   */
  async listConnections(organizationId: string): Promise<GitConnection[]> {
    return gitConnectionRepository.findActiveByOrganization(organizationId);
  }

  /**
   * Remove a git connection and optionally its plugins.
   */
  async removeConnection(
    connectionId: string,
    organizationId: string,
    removePlugins: boolean = false,
  ): Promise<void> {
    const connection = await gitConnectionRepository.findById(connectionId);
    if (!connection || connection.organizationId !== organizationId) {
      throw new Error("Git connection not found");
    }

    if (removePlugins) {
      const plugins = await pluginRegistryRepository.findByGitConnection(connectionId);
      for (const plugin of plugins) {
        await this.removeGitPlugin(plugin, organizationId);
      }
    }

    await gitConnectionRepository.deleteConnection(connectionId);
    logger.info({ connectionId, organizationId }, "Git connection removed");
  }

  /**
   * List repos available from a git connection.
   */
  async listAvailableRepos(connectionId: string, organizationId: string): Promise<GitRepoInfo[]> {
    const connection = await this.getValidConnection(connectionId, organizationId);
    const provider = this.getProvider(connection.provider);
    return provider.listRepositories(connection.installationId);
  }

  /**
   * Install a plugin from a git repository.
   */
  async installPluginFromRepo(params: {
    connectionId: string;
    organizationId: string;
    repoFullName: string;
    branch?: string;
    userId: string;
  }): Promise<PluginRegistry> {
    const { connectionId, organizationId, repoFullName, userId } = params;
    const connection = await this.getValidConnection(connectionId, organizationId);
    const provider = this.getProvider(connection.provider);

    // Determine branch — use provided or fetch default
    let branch = params.branch;
    if (!branch) {
      const repos = await provider.listRepositories(connection.installationId);
      const repo = repos.find((r) => r.fullName === repoFullName);
      branch = repo?.defaultBranch || "main";
    }

    logger.info({ repoFullName, branch, organizationId }, "Installing plugin from git repo");

    // Download archive
    const archive = await provider.downloadArchive(connection.installationId, repoFullName, branch);

    // Validate the tarball contains a valid plugin
    const { manifest, pluginId } = await validateTarball(archive.buffer);

    // Check if plugin already exists for this org
    const existing = await pluginRegistryRepository.findByPluginId(pluginId);
    if (existing && existing.organizationId === organizationId) {
      throw new Error(`Plugin ${pluginId} already exists. Use syncPlugin to update it.`);
    }

    // Upload archive to S3/local storage
    const { storageService } = await import("./storage.service");
    const uploadResult = await storageService.uploadPluginZip({
      buffer: archive.buffer,
      originalName: `${pluginId}.tar.gz`,
      pluginId,
      organizationId,
      uploadedById: userId,
    });

    // Extract to filesystem
    const extractPath = path.join(this.pluginsDir, "custom", organizationId, pluginId);
    const orgDir = path.join(this.pluginsDir, "custom", organizationId);
    await fs.mkdir(orgDir, { recursive: true });

    // Remove existing directory if present
    await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    await extractTarball(archive.buffer, extractPath);

    // Register plugin
    const { pluginManagerService } = await import("./plugin-manager.service");
    await pluginManagerService.registerPlugin(extractPath, "git", organizationId);

    // Install dependencies and build
    await pluginManagerService.installPlugin(pluginId);
    await pluginManagerService.buildPlugin(pluginId);

    // Update registry with git metadata
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (plugin) {
      await AppDataSource.getRepository(
        (await import("@server/entities/plugin-registry.entity")).PluginRegistry,
      ).update(plugin.id, {
        gitConnectionId: connectionId,
        gitRepoFullName: repoFullName,
        gitBranch: branch,
        gitLastCommitSha: archive.commitSha,
        gitLastSyncAt: new Date(),
        zipFilePath: uploadResult.upload.path,
        zipUploadId: uploadResult.upload.id,
        uploadedById: userId,
        uploadedAt: new Date(),
      } as any);
    }

    logger.info(
      { pluginId, repoFullName, branch, commitSha: archive.commitSha },
      "Plugin installed from git repo",
    );

    return (await pluginRegistryRepository.findByPluginId(pluginId))!;
  }

  /**
   * Check if a git-sourced plugin has updates available.
   */
  async checkForUpdates(pluginRegistryId: string): Promise<{
    hasUpdate: boolean;
    currentSha?: string;
    latestSha?: string;
  }> {
    const plugin = await pluginRegistryRepository.findById(pluginRegistryId);
    if (!plugin || plugin.sourceType !== "git" || !plugin.gitConnectionId) {
      throw new Error("Plugin is not a git-sourced plugin");
    }

    const connection = await gitConnectionRepository.findById(plugin.gitConnectionId);
    if (!connection || connection.status !== "active") {
      throw new Error("Git connection not found or inactive");
    }

    const provider = this.getProvider(connection.provider);
    const latest = await provider.getLatestCommit(
      connection.installationId,
      plugin.gitRepoFullName!,
      plugin.gitBranch!,
    );

    return {
      hasUpdate: latest.sha !== plugin.gitLastCommitSha,
      currentSha: plugin.gitLastCommitSha || undefined,
      latestSha: latest.sha,
    };
  }

  /**
   * Sync a single git-sourced plugin (re-download if changed).
   */
  async syncPlugin(pluginRegistryId: string): Promise<{ updated: boolean; newSha?: string }> {
    const plugin = await pluginRegistryRepository.findById(pluginRegistryId);
    if (!plugin || plugin.sourceType !== "git" || !plugin.gitConnectionId) {
      throw new Error("Plugin is not a git-sourced plugin");
    }

    const connection = await gitConnectionRepository.findById(plugin.gitConnectionId);
    if (!connection || connection.status !== "active") {
      throw new Error("Git connection not found or inactive");
    }

    const provider = this.getProvider(connection.provider);

    // Check if there's an update
    const latest = await provider.getLatestCommit(
      connection.installationId,
      plugin.gitRepoFullName!,
      plugin.gitBranch!,
    );

    if (latest.sha === plugin.gitLastCommitSha) {
      // No update needed
      await AppDataSource.getRepository(
        (await import("@server/entities/plugin-registry.entity")).PluginRegistry,
      ).update(plugin.id, {
        gitLastSyncAt: new Date(),
        gitSyncError: null,
      } as any);
      return { updated: false };
    }

    logger.info(
      { pluginId: plugin.pluginId, oldSha: plugin.gitLastCommitSha, newSha: latest.sha },
      "Plugin update detected, syncing",
    );

    // Download new archive
    const archive = await provider.downloadArchive(
      connection.installationId,
      plugin.gitRepoFullName!,
      plugin.gitBranch!,
    );

    // Stop running workers — track if it was running so we can restart after update
    let wasRunning = false;
    const { getPluginRunnerService } = await import("./plugin-runner.service");
    const runner = getPluginRunnerService();
    try {
      if (plugin.organizationId && runner.isRunning(plugin.organizationId, plugin.pluginId)) {
        wasRunning = true;
        await runner.stopWorker(plugin.organizationId, plugin.pluginId);
      }
    } catch {
      // Runner may not be available, continue
    }

    // Upload new archive to S3
    const { storageService } = await import("./storage.service");

    // Delete old archive
    if (plugin.zipUploadId) {
      await storageService.delete(plugin.zipUploadId).catch((err: Error) => {
        logger.warn({ err, pluginId: plugin.pluginId }, "Failed to delete old archive");
      });
    }

    const uploadResult = await storageService.uploadPluginZip({
      buffer: archive.buffer,
      originalName: `${plugin.pluginId}.tar.gz`,
      pluginId: plugin.pluginId,
      organizationId: plugin.organizationId!,
      uploadedById: plugin.uploadedById || "system",
    });

    // Extract to filesystem
    const extractPath = path.join(this.pluginsDir, plugin.pluginPath);
    await fs.rm(extractPath, { recursive: true, force: true }).catch(() => {});
    await extractTarball(archive.buffer, extractPath);

    // Re-register plugin, reinstall dependencies, and rebuild
    const { pluginManagerService } = await import("./plugin-manager.service");
    await pluginManagerService.registerPlugin(extractPath, "git", plugin.organizationId!);
    await pluginManagerService.installPlugin(plugin.pluginId);
    await pluginManagerService.buildPlugin(plugin.pluginId);

    // Update git metadata
    await AppDataSource.getRepository(
      (await import("@server/entities/plugin-registry.entity")).PluginRegistry,
    ).update(plugin.id, {
      gitLastCommitSha: archive.commitSha,
      gitLastSyncAt: new Date(),
      gitSyncError: null,
      zipFilePath: uploadResult.upload.path,
      zipUploadId: uploadResult.upload.id,
    } as any);

    // Restart worker if it was running before the update
    if (wasRunning && plugin.organizationId) {
      try {
        await runner.startWorker(plugin.organizationId, plugin.pluginId);
        logger.info({ pluginId: plugin.pluginId }, "Restarted plugin worker after sync");
      } catch (error) {
        logger.error(
          { err: error, pluginId: plugin.pluginId },
          "Failed to restart plugin worker after sync",
        );
      }
    }

    logger.info({ pluginId: plugin.pluginId, newSha: archive.commitSha }, "Plugin synced from git");

    return { updated: true, newSha: archive.commitSha };
  }

  /**
   * Sync all git-sourced plugins across all organizations.
   * Called by the scheduled job.
   */
  async syncAllGitPlugins(): Promise<void> {
    const gitPlugins = await pluginRegistryRepository.findAllGitPlugins();
    if (gitPlugins.length === 0) return;

    logger.info({ count: gitPlugins.length }, "Starting git plugin sync");

    let updated = 0;
    let errors = 0;

    for (const plugin of gitPlugins) {
      try {
        const result = await this.syncPlugin(plugin.id);
        if (result.updated) updated++;
      } catch (error) {
        errors++;
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, pluginId: plugin.pluginId }, "Failed to sync git plugin");

        // Record the error on the plugin
        await AppDataSource.getRepository(
          (await import("@server/entities/plugin-registry.entity")).PluginRegistry,
        )
          .update(plugin.id, {
            gitSyncError: message,
            gitLastSyncAt: new Date(),
          } as any)
          .catch(() => {});
      }
    }

    logger.info({ total: gitPlugins.length, updated, errors }, "Git plugin sync complete");
  }

  // --- Private helpers ---

  private async getValidConnection(
    connectionId: string,
    organizationId: string,
  ): Promise<GitConnection> {
    const connection = await gitConnectionRepository.findById(connectionId);
    if (!connection || connection.organizationId !== organizationId) {
      throw new Error("Git connection not found");
    }
    if (connection.status !== "active") {
      throw new Error(`Git connection is ${connection.status}`);
    }
    return connection;
  }

  private async removeGitPlugin(plugin: PluginRegistry, organizationId: string): Promise<void> {
    try {
      // Stop running workers
      const { getPluginRunnerService } = await import("./plugin-runner.service");
      const runner = getPluginRunnerService();
      if (runner.isRunning(organizationId, plugin.pluginId)) {
        await runner.stopWorker(organizationId, plugin.pluginId);
      }
    } catch {
      // Continue even if runner cleanup fails
    }

    // Delete archive from storage
    if (plugin.zipUploadId) {
      const { storageService } = await import("./storage.service");
      await storageService.delete(plugin.zipUploadId).catch(() => {});
    }

    // Delete extracted directory
    const pluginPath = path.join(this.pluginsDir, plugin.pluginPath);
    await fs.rm(pluginPath, { recursive: true, force: true }).catch(() => {});

    // Delete from database
    await AppDataSource.getRepository(
      (await import("@server/entities/plugin-registry.entity")).PluginRegistry,
    ).delete(plugin.id);

    // Remove from in-memory registry
    const { pluginManagerService } = await import("./plugin-manager.service");
    pluginManagerService.registry.delete(plugin.pluginId);

    logger.info({ pluginId: plugin.pluginId }, "Git plugin removed");
  }
}

export const gitConnectionService = new GitConnectionService();
