/**
 * Picks the MCP tool a plugin connection check may call. Only a dedicated health
 * tool, or a read-only tool with no required parameters, is ever returned: never
 * an arbitrary tool, which could be a write action (e.g. send-email).
 */
const SAFE_TOOL_PREFIXES = ["list_", "get_", "search_", "find_", "read_"];

interface ToolLike {
  name: string;
  inputSchema?: { required?: string[] } | null;
  input_schema?: { required?: string[] } | null;
}

function requiredParams(tool: ToolLike): string[] {
  return (tool.inputSchema ?? tool.input_schema)?.required ?? [];
}

export function pickHealthCheckTool<T extends ToolLike>(tools: T[]): T | undefined {
  return (
    tools.find((t) => ["health", "healthcheck"].includes(t.name.toLowerCase())) ??
    tools.find(
      (t) =>
        requiredParams(t).length === 0 &&
        SAFE_TOOL_PREFIXES.some((prefix) => t.name.toLowerCase().startsWith(prefix)),
    )
  );
}
