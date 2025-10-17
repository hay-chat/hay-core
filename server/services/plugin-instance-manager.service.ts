import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { processManagerService } from "./process-manager.service";
import { getUTCNow } from "@server/utils/date.utils";
import { debugLog } from "@server/lib/debug-logger";

interface InstancePoolStats {
  runningCount: number;
  maxAllowed: number;
  queuedRequests: number;
}

export class PluginInstanceManagerService {
  private readonly INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000; // Check every minute
  private cleanupTimer: NodeJS.Timeout | null = null;
  private instanceActivity: Map<string, Date> = new Map();
  private startupQueue: Map<string, Promise<void>> = new Map();
  private instancePools: Map<string, InstancePoolStats> = new Map();

  /**
   * Start the cleanup timer for inactive instances
   */
  startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveInstances().catch((error) => {
        debugLog("plugin-manager", "Error during instance cleanup", { level: "error", data: error });
      });
    }, this.CLEANUP_INTERVAL_MS);

    debugLog("plugin-manager", "Plugin instance cleanup started (checking every minute)");
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      debugLog("plugin-manager", "Plugin instance cleanup stopped");
    }
  }

  /**
   * Ensure a plugin instance is running for an organization
   * This is called on-demand when a plugin is needed
   */
  async ensureInstanceRunning(organizationId: string, pluginId: string): Promise<void> {
    const instanceKey = this.getInstanceKey(organizationId, pluginId);

    // Check if already starting (avoid duplicate startups)
    const existingStartup = this.startupQueue.get(instanceKey);
    if (existingStartup) {
      await existingStartup;
      return;
    }

    // Check if already running
    if (processManagerService.isRunning(organizationId, pluginId)) {
      await this.updateActivityTimestamp(organizationId, pluginId);
      return;
    }

    // Check if we can start this instance (pool limits)
    const canStart = await this.canStartInstance(pluginId);
    if (!canStart) {
      // Queue the request or wait
      debugLog("plugin-manager", `Instance pool limit reached for ${pluginId}, queueing request`);
      await this.waitForAvailableSlot(pluginId);
    }

    // Start the instance
    const startupPromise = this.startInstance(organizationId, pluginId);
    this.startupQueue.set(instanceKey, startupPromise);

    try {
      await startupPromise;
    } finally {
      this.startupQueue.delete(instanceKey);
    }
  }

  /**
   * Start a plugin instance
   */
  private async startInstance(organizationId: string, pluginId: string): Promise<void> {
    try {
      debugLog("plugin-manager", `Starting plugin ${pluginId} for organization ${organizationId} on-demand`);

      await processManagerService.startPlugin(organizationId, pluginId);
      await this.updateActivityTimestamp(organizationId, pluginId);
      this.updatePoolStats(pluginId);
    } catch (error) {
      debugLog("plugin-manager", `Failed to start plugin ${pluginId} for org ${organizationId}`, { level: "error", data: error });

      // Extract meaningful error message
      let errorMessage = "Failed to start plugin";
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Throw a new error with clean message for the API layer
      throw new Error(`Failed to start plugin: ${errorMessage}`);
    }
  }

  /**
   * Update the last activity timestamp for an instance
   */
  async updateActivityTimestamp(organizationId: string, pluginId: string): Promise<void> {
    const instanceKey = this.getInstanceKey(organizationId, pluginId);
    const now = getUTCNow();

    // Update in-memory tracking
    this.instanceActivity.set(instanceKey, now);

    // Update database
    const instance = await pluginInstanceRepository.findByOrgAndPlugin(organizationId, pluginId);

    if (instance) {
      await pluginInstanceRepository.update(instance.id, organizationId, {
        lastActivityAt: now,
      });
    }
  }

  /**
   * Clean up inactive instances
   */
  private async cleanupInactiveInstances(): Promise<void> {
    const now = getUTCNow();
    const inactiveThreshold = new Date(now.getTime() - this.INACTIVITY_TIMEOUT_MS);

    // Get all running instances
    const runningInstances = await pluginInstanceRepository.findRunningInstances();

    for (const instance of runningInstances) {
      const instanceKey = this.getInstanceKey(instance.organizationId, instance.plugin.pluginId);

      // Check in-memory activity first (more recent)
      const memoryActivity = this.instanceActivity.get(instanceKey);
      const lastActivity = memoryActivity || instance.lastActivityAt;

      if (!lastActivity || lastActivity < inactiveThreshold) {
        // Check if instance is actually running in process manager
        if (processManagerService.isRunning(instance.organizationId, instance.plugin.pluginId)) {
          debugLog(
            "plugin-manager",
            `Stopping inactive plugin ${instance.plugin.name} for org ${instance.organizationId} (inactive for ${this.INACTIVITY_TIMEOUT_MS / 1000 / 60} minutes)`,
          );

          try {
            await processManagerService.stopPlugin(
              instance.organizationId,
              instance.plugin.pluginId,
            );
            this.instanceActivity.delete(instanceKey);
            this.updatePoolStats(instance.plugin.pluginId);
          } catch (error) {
            debugLog("plugin-manager", `Error stopping inactive instance ${instanceKey}`, { level: "error", data: error });
          }
        }
      }
    }
  }

  /**
   * Check if we can start a new instance based on pool limits
   */
  private async canStartInstance(pluginId: string): Promise<boolean> {
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    if (!plugin) {
      return false;
    }

    const maxInstances = plugin.maxConcurrentInstances || 10;
    const stats = this.getPoolStats(pluginId);

    return stats.runningCount < maxInstances;
  }

  /**
   * Wait for an available slot in the instance pool
   */
  private async waitForAvailableSlot(pluginId: string): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 1000; // Check every second
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      if (await this.canStartInstance(pluginId)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Timeout waiting for available instance slot for plugin ${pluginId}`);
  }

  /**
   * Get pool statistics for a plugin
   */
  private getPoolStats(pluginId: string): InstancePoolStats {
    const existing = this.instancePools.get(pluginId);
    if (existing) {
      return existing;
    }

    const stats: InstancePoolStats = {
      runningCount: 0,
      maxAllowed: 10,
      queuedRequests: 0,
    };

    this.instancePools.set(pluginId, stats);
    return stats;
  }

  /**
   * Update pool statistics for a plugin
   */
  private updatePoolStats(pluginId: string): void {
    const processes = processManagerService.getRunningProcesses();
    const runningCount = processes.filter((p) => p.pluginName === pluginId).length;

    const stats = this.getPoolStats(pluginId);
    stats.runningCount = runningCount;
  }

  /**
   * Get instance key for tracking
   */
  private getInstanceKey(organizationId: string, pluginId: string): string {
    return `${organizationId}:${pluginId}`;
  }

  /**
   * Get statistics about managed instances
   */
  async getStatistics(): Promise<{
    totalRunning: number;
    totalInactive: number;
    poolStats: Map<string, InstancePoolStats>;
    activityMap: Map<string, Date>;
  }> {
    const runningInstances = await pluginInstanceRepository.findRunningInstances();
    const now = getUTCNow();
    const inactiveThreshold = new Date(now.getTime() - this.INACTIVITY_TIMEOUT_MS);

    let totalInactive = 0;
    for (const instance of runningInstances) {
      const instanceKey = this.getInstanceKey(instance.organizationId, instance.plugin.pluginId);
      const lastActivity = this.instanceActivity.get(instanceKey) || instance.lastActivityAt;

      if (!lastActivity || lastActivity < inactiveThreshold) {
        totalInactive++;
      }
    }

    return {
      totalRunning: runningInstances.length,
      totalInactive,
      poolStats: this.instancePools,
      activityMap: this.instanceActivity,
    };
  }

  /**
   * Force stop all instances for an organization
   */
  async stopAllForOrganization(organizationId: string): Promise<void> {
    const instances = await pluginInstanceRepository.findByOrganization(organizationId);

    for (const instance of instances) {
      if (processManagerService.isRunning(organizationId, instance.plugin.pluginId)) {
        await processManagerService.stopPlugin(organizationId, instance.plugin.pluginId);

        const instanceKey = this.getInstanceKey(organizationId, instance.plugin.pluginId);
        this.instanceActivity.delete(instanceKey);
      }
    }
  }

  /**
   * Set priority for an organization's instances
   */
  async setOrganizationPriority(organizationId: string, priority: number): Promise<void> {
    const instances = await pluginInstanceRepository.findByOrganization(organizationId);

    for (const instance of instances) {
      await pluginInstanceRepository.update(instance.id, organizationId, { priority });
    }
  }
}

export const pluginInstanceManagerService = new PluginInstanceManagerService();
