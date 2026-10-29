import { useRouter } from "vue-router";
import type { HayPageTool } from "@/types/haychat";

/**
 * Hay's own page tools (WebMCP): what an AI agent may do inside the dashboard
 * on the user's behalf. Registered for the Hay widget on the web-embed demo
 * page (so Hay's support chat can drive the app it is embedded in) and for
 * browsers that ship `navigator.modelContext` (so a browser agent can do the
 * same). Every tool is read-only from the data's point of view: it navigates,
 * points and describes; it never changes a record.
 */

const SETTINGS_SECTIONS = [
  "general",
  "profile",
  "users",
  "security",
  "api-tokens",
  "business-hours",
  "llm",
  "actions",
  "privacy",
  "customer-privacy",
  "usage",
  "webchat",
  "git-connections",
] as const;

const text = (value: string) => ({ content: [{ type: "text", text: value }] });
const failure = (value: string) => ({ isError: true, content: [{ type: "text", text: value }] });

/** A visible element whose own text contains `needle` (buttons, links, headings, labels). */
function findByText(needle: string): Element | null {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return null;
  const candidates = document.querySelectorAll(
    "button, a, h1, h2, h3, label, [role='tab'], [role='menuitem'], th, summary",
  );
  for (const el of candidates) {
    if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
    if (el.textContent?.trim().toLowerCase().includes(wanted)) return el;
  }
  return null;
}

export function usePageTools() {
  const router = useRouter();

  const highlight = (target: Element | string | null, label?: string): boolean =>
    window.HayChat?.highlight?.(target, label) ?? false;

  /** Point at the sidebar entry, then go there. */
  const go = async (path: string): Promise<unknown> => {
    const resolved = router.resolve(path);
    if (resolved.matched.length === 0) return failure(`There is no page at ${path}`);
    highlight(`a[href="${resolved.path}"]`);
    await new Promise((r) => setTimeout(r, 350));
    await router.push(resolved.fullPath);
    return text(`Opened ${resolved.fullPath}`);
  };

  const tools: HayPageTool[] = [
    {
      name: "describe_page",
      description:
        "What the user is looking at right now in the Hay dashboard: the current path, the page title, its headings and the buttons on it. Call it before pointing at something.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => {
        const headings = Array.from(document.querySelectorAll("main h1, main h2, main h3"))
          .map((h) => h.textContent?.trim())
          .filter(Boolean)
          .slice(0, 20);
        const buttons = Array.from(document.querySelectorAll("main button, main a"))
          .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
          .map((el) => el.textContent?.trim())
          .filter((label): label is string => !!label && label.length < 60)
          .slice(0, 40);
        return {
          path: router.currentRoute.value.fullPath,
          title: document.title,
          headings,
          buttons: Array.from(new Set(buttons)),
        };
      },
    },
    {
      name: "navigate",
      description:
        "Open a page of the Hay dashboard for the user. Paths: /dashboard, /inbox, /conversations, /customers, /documents, /playbooks, /agents, /tests, /actions, /evidence, /insights, /insights/feedback, /products, /integrations, /channels, /queue, /settings/<section>.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Dashboard path, e.g. /playbooks" } },
        required: ["path"],
      },
      annotations: { readOnlyHint: true },
      execute: ({ path }) => {
        if (typeof path !== "string" || !path.startsWith("/"))
          return failure("path must start with /");
        return go(path);
      },
    },
    {
      name: "open_conversation",
      description: "Open one conversation in the Hay dashboard by its id.",
      inputSchema: {
        type: "object",
        properties: { conversationId: { type: "string" } },
        required: ["conversationId"],
      },
      annotations: { readOnlyHint: true },
      execute: ({ conversationId }) => {
        if (typeof conversationId !== "string" || !/^[\w-]+$/.test(conversationId)) {
          return failure("conversationId is required");
        }
        return go(`/conversations/${conversationId}`);
      },
    },
    {
      name: "open_settings",
      description: `Open a section of the Hay settings. Sections: ${SETTINGS_SECTIONS.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: { section: { type: "string", enum: [...SETTINGS_SECTIONS] } },
        required: ["section"],
      },
      annotations: { readOnlyHint: true },
      execute: ({ section }) => {
        const known = SETTINGS_SECTIONS.find((s) => s === section);
        return known
          ? go(`/settings/${known}`)
          : failure(`Unknown settings section "${String(section)}"`);
      },
    },
    {
      name: "highlight",
      description:
        "Point at something on the current page with an orange highlight so the user can see where it is: a button, link or heading by its visible text, or any element by CSS selector. Scrolls it into view.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Visible text of a button, link or heading" },
          selector: { type: "string", description: "CSS selector, when text is not enough" },
          label: { type: "string", description: "Short note shown next to the highlight" },
        },
      },
      annotations: { readOnlyHint: true },
      execute: ({ text: needle, selector, label }) => {
        const target =
          (typeof selector === "string" && selector ? document.querySelector(selector) : null) ??
          (typeof needle === "string" ? findByText(needle) : null);
        if (!target) return failure("Nothing on this page matches that");
        highlight(target, typeof label === "string" ? label : undefined);
        return text(`Highlighted "${target.textContent?.trim().slice(0, 60) || selector}"`);
      },
    },
  ];

  /** Register with the Hay widget on this page (idempotent: names replace). */
  const registerWithWidget = (): boolean => {
    if (!window.HayChat?.registerTool) return false;
    tools.forEach((tool) => window.HayChat!.registerTool!(tool));
    return true;
  };

  /** Register with a browser that ships WebMCP, for its own agent. */
  const registerWithBrowser = (): boolean => {
    const context = navigator.modelContext;
    if (!context) return false;
    tools.forEach((tool) => context.registerTool(tool));
    return true;
  };

  return { tools, registerWithWidget, registerWithBrowser };
}
