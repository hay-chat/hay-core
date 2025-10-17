import { Orchestrator } from "../orchestrator";
import { AppDataSource } from "../database/data-source";
import { debugLog } from "@server/lib/debug-logger";

export class OrchestratorWorker {
  private orchestrator?: Orchestrator;
  private intervalId: NodeJS.Timeout | null = null;
  private inactivityCheckIntervalId: NodeJS.Timeout | null = null;
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

  start(intervalMs: number = 1000): void {
    if (this.intervalId) {
      debugLog("worker", "Orchestrator worker is already running");
      return;
    }

    debugLog("worker", `Starting orchestrator worker with ${intervalMs}ms interval`);

    this.intervalId = setInterval(async () => {
      if (!this.isProcessing) {
        await this.tick();
      }
    }, intervalMs);

    // Start inactivity check every 5 minutes
    this.inactivityCheckIntervalId = setInterval(
      async () => {
        await this.checkInactivity();
      },
      5 * 60 * 1000,
    ); // 5 minutes

    // Run immediately
    this.tick();
    // Run inactivity check immediately as well
    this.checkInactivity();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      debugLog("worker", "Orchestrator worker stopped");
    }
    if (this.inactivityCheckIntervalId) {
      clearInterval(this.inactivityCheckIntervalId);
      this.inactivityCheckIntervalId = null;
      debugLog("worker", "Inactivity check stopped");
    }
  }

  private async tick(): Promise<void> {
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

  private async checkInactivity(): Promise<void> {
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
