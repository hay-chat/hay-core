/**
 * Process Lifecycle Utilities
 *
 * Helper functions for managing child process lifecycle in plugin MCP servers.
 */

import { ChildProcess } from "child_process";
import * as net from "net";

/**
 * Gracefully kills a child process with SIGTERM, followed by SIGKILL if needed.
 *
 * This function attempts to terminate the process gracefully by sending SIGTERM,
 * giving it time to clean up resources. If the process doesn't exit within the
 * timeout period, it sends SIGKILL to force termination.
 *
 * @param process - The child process to kill
 * @param timeoutMs - Maximum time to wait for graceful shutdown before forcing (default: 5000ms)
 * @returns Promise that resolves when the process has exited
 *
 * @example
 * ```typescript
 * const process = spawn('node', ['server.js']);
 * // Later...
 * await killProcessGracefully(process, 3000);
 * ```
 */
export async function killProcessGracefully(
  process: ChildProcess,
  timeoutMs: number = 5000,
): Promise<void> {
  return new Promise((resolve) => {
    // If process already exited, resolve immediately
    if (process.exitCode !== null) {
      resolve();
      return;
    }

    // Listen for exit event
    process.once("exit", () => {
      resolve();
    });

    // Send SIGTERM for graceful shutdown
    process.kill("SIGTERM");

    // Set timeout for force kill
    const forceKillTimer = setTimeout(() => {
      // Only send SIGKILL if process hasn't exited yet
      if (process.exitCode === null) {
        process.kill("SIGKILL");
      }
    }, timeoutMs);

    // Clear timeout if process exits before timeout
    process.once("exit", () => {
      clearTimeout(forceKillTimer);
    });
  });
}

/**
 * Checks if a TCP port is available for use.
 *
 * Attempts to bind to the specified port to verify it's not already in use.
 * This is useful before spawning processes that need to listen on specific ports.
 *
 * @param port - The port number to check (1-65535)
 * @param host - The host to check (default: 'localhost')
 * @returns Promise that resolves to true if port is available, false otherwise
 *
 * @example
 * ```typescript
 * const available = await isPortAvailable(3000);
 * if (!available) {
 *   throw new Error('Port 3000 is already in use');
 * }
 * ```
 */
export async function isPortAvailable(port: number, host: string = "localhost"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false); // Port is in use
      } else {
        resolve(false); // Other error, assume port is not available
      }
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true); // Port is available
      });
    });

    server.listen(port, host);
  });
}

/**
 * Finds an available port within a specified range.
 *
 * Searches for an available port starting from the minimum port number.
 * Useful when you need to dynamically allocate a port for a service.
 *
 * @param minPort - Minimum port number to try (default: 3000)
 * @param maxPort - Maximum port number to try (default: 65535)
 * @param host - The host to check (default: 'localhost')
 * @returns Promise that resolves to an available port number, or null if none found
 *
 * @example
 * ```typescript
 * const port = await findAvailablePort(8000, 9000);
 * if (!port) {
 *   throw new Error('No available ports in range 8000-9000');
 * }
 * console.log(`Using port ${port}`);
 * ```
 */
export async function findAvailablePort(
  minPort: number = 3000,
  maxPort: number = 65535,
  host: string = "localhost",
): Promise<number | null> {
  for (let port = minPort; port <= maxPort; port++) {
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  return null; // No available port found in range
}
