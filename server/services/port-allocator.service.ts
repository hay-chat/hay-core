import { createServer } from "net";

/**
 * Port Allocator Service
 *
 * Manages dynamic port allocation for plugin workers.
 * Uses Core-allocated dynamic port pool strategy (Phase 1 implementation).
 *
 * Strategy:
 * - Core allocates ports from a configurable range (default: 5000-65535)
 * - Checks port availability before allocation
 * - Tracks allocated ports to prevent conflicts
 * - Releases ports when workers stop
 *
 * Future Enhancement:
 * - Option: OS-assigned ports with stdout handshake
 * - Runner prints `HAY_WORKER_PORT=12345` on successful bind
 * - Core parses stdout to learn actual port
 */
export class PortAllocatorService {
  private allocatedPorts = new Set<number>();
  private basePort: number;
  private maxPort: number;

  constructor(basePort = 5000, maxPort = 65535) {
    this.basePort = basePort;
    this.maxPort = maxPort;
  }

  /**
   * Allocate an available port
   * @returns Allocated port number
   * @throws Error if no ports available
   */
  async allocate(): Promise<number> {
    // Try up to 100 times to find an available port
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      // Generate random port in range to avoid sequential allocation issues
      const port = Math.floor(Math.random() * (this.maxPort - this.basePort + 1)) + this.basePort;

      // Skip if already allocated
      if (this.allocatedPorts.has(port)) {
        attempts++;
        continue;
      }

      // Check if port is actually available on the system
      const isAvailable = await this.isPortAvailable(port);
      if (isAvailable) {
        this.allocatedPorts.add(port);
        return port;
      }

      attempts++;
    }

    throw new Error(
      `Failed to allocate port after ${maxAttempts} attempts. ` +
      `Current allocated: ${this.allocatedPorts.size}, Range: ${this.basePort}-${this.maxPort}`
    );
  }

  /**
   * Release a previously allocated port
   * @param port Port number to release
   */
  release(port: number): void {
    this.allocatedPorts.delete(port);
  }

  /**
   * Get count of currently allocated ports
   */
  getAllocatedCount(): number {
    return this.allocatedPorts.size;
  }

  /**
   * Check if a specific port is allocated
   */
  isAllocated(port: number): boolean {
    return this.allocatedPorts.has(port);
  }

  /**
   * Reset all allocations (useful for testing)
   */
  reset(): void {
    this.allocatedPorts.clear();
  }

  /**
   * Check if a port is available on the system
   * Attempts to bind to the port and immediately releases it
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          // Other errors (e.g., permission issues) also mean port not available
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close();
        resolve(true);
      });

      server.listen(port, "127.0.0.1");
    });
  }
}

// Singleton instance
let portAllocator: PortAllocatorService | null = null;

/**
 * Get or create the singleton PortAllocator instance
 */
export function getPortAllocator(): PortAllocatorService {
  if (!portAllocator) {
    portAllocator = new PortAllocatorService();
  }
  return portAllocator;
}
