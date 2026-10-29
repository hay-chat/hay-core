/**
 * The Hay webchat widget's host API (webchat/src/types), as the dashboard sees
 * it when it embeds its own widget (demo page) and registers page tools.
 */
export interface HayPageTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface HayModelContext {
  registerTool(tool: HayPageTool): void;
  unregisterTool(name: string): void;
  provideContext(context: { tools?: HayPageTool[] }): void;
  clearContext(): void;
}

declare global {
  interface Window {
    HayChat?: {
      config?: {
        organizationId?: string;
        pluginId?: string;
        baseUrl?: string;
        widgetTitle?: string;
        widgetSubtitle?: string;
        position?: string;
        theme?: string;
        showGreeting?: boolean;
        greetingMessage?: string;
      };
      addContext?: (key: string, value: unknown) => void;
      registerTool?: (tool: HayPageTool) => void;
      unregisterTool?: (name: string) => void;
      highlight?: (target: Element | string | null, label?: string) => boolean;
    };
  }
  interface Navigator {
    /** WebMCP (draft): present natively in browsers that ship it, or provided by the widget. */
    modelContext?: HayModelContext;
  }
}
