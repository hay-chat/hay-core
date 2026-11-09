/** JSON lines on stdout/stderr. The supervisor loads no plugin code and no core configuration. */
type Level = "info" | "warn" | "error";

function write(level: Level, message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: "plugin-host",
    msg: message,
    ...fields,
  });
  (level === "info" ? process.stdout : process.stderr).write(`${line}\n`);
}

export const log = {
  info: (message: string, fields: Record<string, unknown> = {}) => write("info", message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write("warn", message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write("error", message, fields),
};
