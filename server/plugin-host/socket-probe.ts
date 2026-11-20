import net from "net";

/** How long to wait between the two probes that must both fail before a socket counts as gone. */
export const PROBE_RECHECK_MS = 3000;

/**
 * Whether the unix socket at `socketPath` is certainly not served: nothing
 * listens on it (ECONNREFUSED) or the file is missing (ENOENT). A timeout or any
 * other error means a busy or unwell listener, not an absent one, so it is not
 * reported as gone.
 */
export function socketIsGone(socketPath: string, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    const done = (gone: boolean): void => {
      socket.destroy();
      resolve(gone);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(false));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ECONNREFUSED" || error.code === "ENOENT"),
    );
  });
}

/** Whether each probe of `socketPath`, `recheckMs` apart, finds it gone. */
export async function socketConfirmedGone(
  socketPath: string,
  recheckMs = PROBE_RECHECK_MS,
): Promise<boolean> {
  if (!(await socketIsGone(socketPath))) return false;
  await new Promise((resolve) => setTimeout(resolve, recheckMs));
  return socketIsGone(socketPath);
}
