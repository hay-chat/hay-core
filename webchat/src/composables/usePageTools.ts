import { ref } from "vue";
import type { PageTool } from "@/types";

/**
 * Page tools (WebMCP): the tools the host page registered for the AI to call
 * in this browser. The registry is module state like the widget context: the
 * host API and the chat read the same map.
 */

/** What the server (and the AI) learns about a tool: everything but `execute`. */
export interface PageToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

const tools = new Map<string, PageTool>();
/** Names registered through `navigator.modelContext`, which `provideContext` replaces wholesale. */
const modelContextNames = new Set<string>();
/** Bumped on every change so the chat can re-send the list to the server. */
export const pageToolsVersion = ref(0);

function changed(): void {
  pageToolsVersion.value++;
}

export function registerTool(tool: PageTool): void {
  if (!tool || typeof tool !== "object" || typeof tool.execute !== "function") {
    console.error("[Hay Webchat] registerTool: a tool needs a name, a description and execute()");
    return;
  }
  if (typeof tool.name !== "string" || !NAME_PATTERN.test(tool.name)) {
    console.error(`[Hay Webchat] registerTool: invalid tool name "${String(tool.name)}"`);
    return;
  }
  if (typeof tool.description !== "string" || !tool.description.trim()) {
    console.error(`[Hay Webchat] registerTool: tool "${tool.name}" needs a description`);
    return;
  }
  tools.set(tool.name, tool);
  changed();
}

export function unregisterTool(name: string): void {
  if (tools.delete(name)) {
    modelContextNames.delete(name);
    changed();
  }
}

/** WebMCP `provideContext({ tools })`: the given tools replace the previous set from that API. */
export function provideContext(context: { tools?: PageTool[] }): void {
  for (const name of modelContextNames) tools.delete(name);
  modelContextNames.clear();
  for (const tool of context?.tools ?? []) {
    registerTool(tool);
    if (tools.has(tool.name)) modelContextNames.add(tool.name);
  }
  changed();
}

export function listPageTools(): PageToolDescriptor[] {
  return Array.from(tools.values(), (tool) => ({
    name: tool.name,
    description: tool.description.trim(),
    inputSchema: tool.inputSchema ?? { type: "object" },
    ...(typeof tool.annotations?.readOnlyHint === "boolean"
      ? { annotations: { readOnlyHint: tool.annotations.readOnlyHint } }
      : {}),
  }));
}

export function hasPageTools(): boolean {
  return tools.size > 0;
}

/** Run a tool the AI asked for. Throws when the page no longer has it or it fails. */
export async function executePageTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Page tool "${name}" is not registered on this page`);
  return tool.execute(args && typeof args === "object" ? args : {});
}

/** Tests only. */
export function resetPageTools(): void {
  tools.clear();
  modelContextNames.clear();
}
