# WebMCP page tools for Hay (Lane B from PR #72)

Branch `claude/modest-cray-0i6zh0`. Builds the "client-side tools" lane the VTEX research
(`tasks/vtex-agentic-chat-research.md`, PR #72) recommended prototyping: a page that embeds the Hay
widget registers typed tools (WebMCP shape); the AI calls them inside the visitor's browser session.

## Goal / acceptance criteria

- [x] Host page API, WebMCP-shaped: `HayChat.registerTool({ name, description, inputSchema, execute })`,
      `unregisterTool(name)`, `highlight(target, label?)`. Works before the chat chunk loads (queued).
- [x] `navigator.modelContext` polyfill when the browser has no WebMCP; tee into Hay's registry when it does,
      so a page written for the standard needs no Hay-specific code.
- [x] Widget sends tool descriptors on `identify` (and `register_tools` when the list changes); server
      stores them per conversation while a socket is alive (Redis with TTL, memory fallback).
- [x] Planner sees them as a third tool source (`page:<name>`), exempt from `enabled_tools` like core tools.
- [x] Dispatch: `page:` branch in `ToolExecutionService.executeToolCall` → `tool_call` over the
      conversation socket → await `tool_result` (15 s timeout → tool error the LLM can react to).
      Works across server instances through Redis (`websocket:events` down, `webchat:page-tool-results` up).
- [x] Visual feedback in the page while a tool runs: orange viewport frame + status pill + moving cursor +
      element highlight (the Claude-in-Chrome look).
- [x] Demo: the Hay dashboard registers its own page tools (navigate, open conversation, open settings,
      highlight, describe page) so Hay's webchat on `/demo/web-embed` can support a Hay user in the app.
- [x] Kill switch: `WEBCHAT_PAGE_TOOLS=false` on the server disables registration and dispatch.
- [x] Tests: server unit tests for the registry/round-trip, webchat tests for the host API, socket
      protocol and overlay; typecheck + lint on touched packages.

## Decisions

- Namespace `page:` (not `client:`): the prompt reads "page tools", matches the WebMCP wording.
- Page tools never go through the merchant approval gate (`runStep`): they run in the visitor's own
  browser with the visitor watching, touch no provider and carry no secrets. The guardrail is that only
  the page's own code can register tools, so the page author decides what the AI may do. Same risk class
  as core tools (`CORE_TOOL_RISK`). Every call is still written to the action log and the tool ledger.
- Tool results are MCP-shaped (`{ content: [{ type: "text", text }] }`) and unwrapped to text for the LLM,
  like MCP tool results; a plain return value is JSON-serialised.
- No plugin-manifest change yet. A `pageTools` capability (plugins shipping a storefront script that
  registers tools, e.g. Shopify `add_to_cart`) is the natural next step; see "Next steps".

## Working notes

- Orchestrator worker and WS server run in one process by default (`server/main.ts`) but WS events are
  already bridged over Redis for multi-instance; the round-trip follows the same bridge.
- `handleRedisEvent`'s final `else` sends unknown event types to every org client: the `page_tool_call`
  branch must come before it, and the payload must never go to org (dashboard) clients.
- Webchat loader budget: 10 KB brotli for widget.js. Host API stubs only queue calls; the overlay lives
  in the chat chunk.

## Results

What changed:

- Server: `server/services/webchat/page-tools.service.ts` (registry, validation, call/resolve round-trip
  with Redis bridging), `websocket.service.ts` (`tools` on identify, `register_tools`, `tool_result`,
  `page_tool_call` forwarding, clear on last disconnect), `execution.layer.ts` (third tool source +
  `pageToolsDetail`), `run.ts` (gate exemption), `tool-execution.service.ts` (`page:` risk + dispatch),
  planner prompts en/pt, `config/env.ts` (`WEBCHAT_PAGE_TOOLS`).
- Webchat: `loader/hostApi.ts` (queued `registerTool`/`unregisterTool`, `window.HayChat.tools` drain,
  `navigator.modelContext` shim/tee), `composables/usePageTools.ts` (registry), `useWebSocket.ts`
  (protocol), `useChat.ts` (run + overlay + answer), `utils/agentActivity.ts` (orange frame, pill,
  cursor, highlight), `chat.ts` (replay + live host API), `Widget.vue` (agent name on the pill).
- Dashboard: `composables/usePageTools.ts` (Hay's five tools), `plugins/webmcp.client.ts` (native WebMCP
  registration), `pages/demo/web-embed.vue` (registers with the widget, shows the tools and prompts),
  `types/haychat.d.ts`.
- Docs: `webchat/PAGE_TOOLS.md`.

Verified:

- `server`: `jest tests/services/page-tools.service.test.ts` (10 tests) plus action-policy,
  customer-confirmation and `tests/orchestrator` suites: 23 suites, 151 tests green; `tsc --noEmit` clean.
- `webchat`: vitest 24 files / 150 tests green; `vue-tsc --noEmit` clean; `npm run build && npm run
  check:perf` within budget (loader 2.9 KB, chat chunk 47.2 KB of 48 KB brotli).
- `dashboard`: `nuxt typecheck` clean; eslint clean on touched files.
- Not run here: a live end-to-end turn (needs a running server with an LLM key). Manual check:
  open `/demo/web-embed`, ask "take me to the playbooks page", expect the orange frame, the sidebar
  link highlighted, the route change, and a TOOL message `page:navigate` in the conversation.

## Next steps

- Plugin capability `pageTools`: a plugin ships `storefront/page-tools.js` that the merchant adds next to
  the widget (or the widget loads from the plugin's public dir), registering e.g. `add_to_cart`,
  `open_cart`, `apply_coupon` against the platform's storefront JS API.
- Per-org setting in Settings > Webchat to turn page tools off, plus a list of what the page registered
  in the conversation view (today it is only in the TOOL message metadata).
- Declarative WebMCP (annotated forms) once the spec stabilises.
