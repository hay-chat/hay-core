import { Orchestrator } from "../orchestrator";
import { AppDataSource } from "../database/data-source";
import { debugLog } from "@server/lib/debug-logger";

export class OrchestratorWorker {
  private orchestrator?: Orchestrator;
  private isProcessing = false;
  private initialized = false;

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Only initialize if database is connected
    if (!AppDataSource.isInitialized) {
      console.warn("Database not initialized, skipping orchestrator initialization");
      return;
    }

    try {
      this.orchestrator = new Orchestrator();
      this.initialized = true;
      debugLog("worker", "Orchestrator worker initialized successfully");
    } catch (error) {
      console.error("Failed to initialize orchestrator worker:", error);
      this.initialized = false;
    }
  }

  /**
   * Start the orchestrator worker
   * NOTE: Worker processing is now handled by the scheduler service
   * See: server/services/scheduled-jobs.registry.ts -> 'orchestrator-worker-tick' and 'orchestrator-inactivity-check'
   */
  start(intervalMs: number = 1000): void {
    debugLog("worker", "Orchestrator worker processing handled by scheduler service");
    // Run immediately once
    this.tick();
    this.checkInactivity();
  }

  /**
   * Stop the orchestrator worker
   * NOTE: Worker processing is now handled by the scheduler service
   */
  stop(): void {
    debugLog("worker", "Orchestrator worker processing handled by scheduler service");
  }

  /**
   * Process one tick of the orchestrator
   * Called by scheduled job: 'orchestrator-worker-tick'
   */
  async tick(): Promise<void> {
    this.isProcessing = true;

    try {
      // Initialize if not already done
      await this.initialize();

      if (!this.initialized || !this.orchestrator) {
        // Skip if not initialized
        return;
      }

      // Run the orchestrator loop
      await this.orchestrator.loop();
    } catch (error) {
      console.error("Orchestrator tick error:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Check for inactive conversations
   * Called by scheduled job: 'orchestrator-inactivity-check'
   */
  async checkInactivity(): Promise<void> {
    try {
      // Initialize if not already done
      await this.initialize();

      if (!this.initialized || !this.orchestrator) {
        // Skip if not initialized
        return;
      }

      // Call the orchestrator's inactivity check method
      await this.orchestrator.checkInactivity();
    } catch (error) {
      console.error("[Worker] Inactivity check error:", error);
    }
  }
}

// Export singleton instance
export const orchestratorWorker = new OrchestratorWorker();
