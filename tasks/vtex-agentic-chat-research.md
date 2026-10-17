# VTEX Agentic Chat & Client-Side Tools for Hay — Research

**Date:** 2026-08-17 · **Status:** Research only, no implementation · **Author:** Claude (requested by Roger)

**Question:** VTEX ships an AI chat that is genuinely integrated with the storefront — it adds items to the cart, calculates shipping, acts on the same UI the shopper sees. What exactly did they build, does it make sense for Hay, and is a "pseudo-MCP that runs client-side" the right mechanism?

**TL;DR:**

1. **VTEX's assistant is real and deep, but its integration trick is _server-side_, not client-side.** The chat brain runs on their CX Platform (from the 2024 Weni acquisition) with direct internal access to the cart (orderForm), OMS, catalog, promotions, and checkout. The web widget is just a script-injected client. Cart actions "feel frontend" because VTEX owns the cart state server-side and the storefront reads that same state.
2. **A real standard for client-side tools is emerging: WebMCP** (W3C, backed by Google + Microsoft, Chrome origin trial running in 2026). Pages register typed JS tools (`document.modelContext.registerTool(...)`) that agents call inside the user's session. Every production chat-widget vendor that does frontend actions today (Crisp, OpenAI ChatKit, CopilotKit, Vercel AI SDK) uses the same shape: JSON-Schema descriptor + page-side execute callback + widget-mediated transport.
3. **For Hay, this splits into two lanes.** Lane A (cheap, covers most of the VTEX demo): pass the shopper's cart/session ID from the host page into the conversation via the existing `window.HayChat.addContext`, and let ordinary server-side plugin tools mutate the cart through platform APIs. Lane B (new capability): a WebMCP-shaped `HayChat.registerTool()` client-tool registry with a WebSocket round-trip — Hay's architecture has a single, clean insertion point for it. Recommendation: do Lane A per-platform now, prototype Lane B behind a flag, keep the API surface WebMCP-compatible so it becomes a thin shim over the browser standard later.

---

## Part 1 — What VTEX actually built

### 1.1 Timeline

- **Sept 2024** — VTEX acquires **Weni**, a Brazilian conversational-AI/CX company. Weni's platform is the backbone of everything below.
- **Aug 2025 (VTEX Vision 2025)** — "first phase of a fully agentic commerce platform": launches **Customer Service Agent**, **AI Personal Shopper**, **AI Quotation** (B2B).
- **Apr 2026 (VTEX Vision 2026)** — "AI-native commerce suite": **AI Workspace** (agentic admin), **WhatsApp Store** (full in-chat shopping), **Voice Commerce**, **Google UCP integration** (checkout inside Gemini / Google AI Mode).

### 1.2 The product family (condensed)

| Product                                                             | What it does                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer Service Agent**                                          | Autonomous support across WhatsApp, Instagram, SMS, webchat: order status, returns/exchanges, cancellations, tracking, subscriptions. Claimed 92% of tickets resolved without a human (UNICEF, Cencosud). |
| **AI Personal Shopper / Shopping Assistant**                        | The storefront-embedded conversational shopper: semantic search, recommendations, promotions, cart building.                                                                                              |
| **Agent Builder + Agent Gallery**                                   | Orchestrator agent + prebuilt "collaborating agents": Cart Recovery, Order Status/Tracking, Concierge (catalog), One-Click Payment, Cancellation/Exchange & Return, Marketing Campaigns.                  |
| **WhatsApp Store**                                                  | End-to-end shopping inside WhatsApp: catalog, cart, shipping calculation, address confirmation, SmartCheckout payment — no redirect.                                                                      |
| **AI Workspace / Data Insights / Search Optimizer / Visual Editor** | Merchant-facing agents (conversational admin, NL analytics, search merchandising, storefront editing). Not shopper-facing.                                                                                |

### 1.3 Capability check (the ones we care about)

| Capability               | Status                           | Notes                                                                                                                                                                                                              |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add items to cart        | **Confirmed** (chat channels)    | "Build the cart and close the sale" is core marketing copy; explicit for WhatsApp. For the _web_ widget, docs say "product and post-purchase questions" — web add-to-cart is probable but not verbatim-documented. |
| Calculate shipping       | **Confirmed** (WhatsApp flow)    | "Cart built in chat with address confirmation and shipping calculation." VTEX's Checkout API has a first-class freight-simulation endpoint (`Simulate a shopping cart`).                                           |
| Order status / tracking  | **Confirmed, strongest feature** | Marketing line: "The agent does not look up order status: it already has it" — direct OMS access.                                                                                                                  |
| Product discovery        | **Confirmed**                    | Conversational + hybrid semantic search with native catalog, stock, and active promotions.                                                                                                                         |
| Apply promotions         | **Confirmed**                    |                                                                                                                                                                                                                    |
| In-chat checkout/payment | **Confirmed (chat)**             | SmartCheckout inside WhatsApp, One-Click Payment agent.                                                                                                                                                            |

### 1.4 How it's integrated — the important part

- **The widget is thin; the brain is server-side.** On FastStore (VTEX's current storefront framework, v3.98.0+), the assistant is a CMS-registered `ShoppingAssistant` section that loads a **third-party script from the CX Platform** — i.e., a script-injected chat widget, same embedding model as Hay's webchat. Activation is point-and-click from the VTEX Admin ("Agentic CX" dashboard), not custom code.
- **The platform advantage is data-plane access, not browser magic.** VTEX's stated differentiator: agents have "direct access to OMS, catalog, SmartCheckout and promotions — no external APIs, no middleware." Tool calls hit VTEX's own modules natively.
- **The cart is server state.** VTEX's cart is the **orderForm** object of their Checkout API (`orderFormId` identifies the shopper's cart+session; endpoints exist for adding items and simulating freight). Because the storefront UI and the agent both read/write the same server-side orderForm, an agent cart mutation _is_ a storefront cart mutation. (That the cart icon updates live without a refresh is an inference — not explicitly documented — but the substrate makes it natural.)
- **WhatsApp is the flagship channel**, not web chat. The most complete flow (browse → cart → shipping → address → payment) ships on WhatsApp. Very LatAm-shaped. Claimed numbers: +41% average ticket and 72% automation for the WhatsApp concierge; 91%+ of post-sales interactions AI-handled.
- **Pricing signals:** the Weni Agentic AI app uses outcome-based pricing (success fee per AI-resolved interaction); semantic search beta notes "additional fees may apply"; no public price list for the CX Platform (enterprise-negotiated).

**Takeaway:** VTEX did _not_ build client-side tool execution. They built a vertically integrated server-side agent and get the "integrated with the frontend" effect for free because they own the commerce backend the frontend renders. Hay can't own the backend — but it can borrow the same trick wherever the host platform's cart is addressable server-side by an ID that the host page knows.

### 1.5 Shopify, for contrast

- **Sidekick** is merchant-facing only ("Sidekick cannot talk to your customers").
- Shopper-facing strategy is **protocol/traffic-oriented**: Global Catalog syndication into ChatGPT/Gemini/Copilot ("Agentic Storefronts", default-on for eligible US merchants since Mar 2026), co-authorship of **ACP** (with OpenAI/Stripe) and **UCP** (with Google).
- For on-storefront chat, Shopify offers DIY tooling: **Storefront MCP** (catalog/cart/checkout tools) plus a reference `shop-chat-agent` widget — no operated first-party concierge. This leaves a genuine gap that products like Hay fill.
- Notably: VTEX and Shopify both plugged into Google's UCP — the traffic-acquisition side of agentic commerce is consolidating on protocols, while the on-site experience remains open territory.

---

## Part 2 — The client-side tool landscape ("pseudo-MCP in the browser")

### 2.1 WebMCP — the emerging standard, and it's exactly this idea

- **What:** a proposed web standard letting a page register typed tools that AI agents can call, executing in the page's JS context with the user's existing session. Incubated in the **W3C Web Machine Learning CG**, accepted as a W3C deliverable; spec authored by **Microsoft (Edge) and Google (Chrome)** engineers. The MCP-B project (Alex Nahas) that pioneered this was folded into it.
- **API shape (current draft):**

```js
await document.modelContext.registerTool({
  name: "add-to-cart",
  description: "Add a product variant to the shopper's cart",
  inputSchema: {
    type: "object",
    properties: { variantId: { type: "string" }, quantity: { type: "number" } },
    required: ["variantId"],
  },
  async execute({ variantId, quantity }) {
    await window.storeCart.add(variantId, quantity ?? 1);
    return { content: [{ type: "text", text: "Added to cart." }] };
  },
});
```

Results are deliberately MCP-shaped (`content: [{type: "text", ...}]`) so MCP clients can consume them. There's also a declarative HTML surface (annotate existing forms as tools).

- **Status (Aug 2026):** prototype behind a flag in Chrome Canary since ~146; **public origin trial announced May 2026, running roughly Chrome 149–156** (into late 2026). Google says Gemini-in-Chrome will be the first mainstream consumer. Mozilla: neutral/undecided; WebKit: no position, with API-design and security concerns on file. E-commerce cart/search is one of the spec's own canonical use cases.
- **Two consumer types in the spec's framing:** (1) browser-built-in agents (Gemini in Chrome, Copilot in Edge) calling page tools; (2) **in-page agents in cross-origin iframes — i.e., embedded chat widgets — calling tools the host page exposes.** Case 2 is Hay's case, and it's an active design-discussion area (origin gating via `exposedTo` + iframe Permissions Policy).
- **Caveat:** timeline/status details for Chrome come partly from secondary coverage (several primary pages were unreachable from this environment); treat exact trial versions as approximate.

### 2.2 Where the official MCP spec stands

- MCP defines only two standard transports (stdio, Streamable HTTP). **There is no sanctioned in-browser/postMessage transport**; a proposal for one (SEP #1005, July 2025) went dormant. The browser-native effort effectively moved to the W3C instead of the MCP org.
- Community packages from the MCP-B lineage (`@mcp-b/transports`, `@mcp-b/webmcp-polyfill`, etc.) implement MCP-over-postMessage and a `document.modelContext` polyfill today. So "pseudo-MCP client-side" is buildable now with standard-compatible parts, ahead of browser support.

### 2.3 What production chat products do today

Every vendor that lets its AI act on the host frontend converges on the same three-part contract — schema + page-side callback + mediated transport:

- **Crisp ("Hugo" AI):** host page subscribes to frontend actions via `$crisp.push(["on", "hugo:tool:<name>", callback])` — the closest shipping analogue to what Hay would build.
- **OpenAI ChatKit:** agent marks a tool client-side; the embedding page implements `onClientTool: async (toolCall) => {...}` and returns JSON to the server-side run.
- **CopilotKit:** `useCopilotAction({name, description, parameters, handler})` — the de-facto OSS pattern for in-app copilots.
- **Vercel AI SDK:** a tool defined without server `execute` is dispatched to the browser via `onToolCall`; result returned with `addToolOutput`.
- **Contrast:** Intercom Fin and Ada actions are server-side API calls only — no host-page execution. Forethought went the other way (browser-automation RPA, no site cooperation).

### 2.4 Adjacent but different: agentic commerce protocols

ACP (OpenAI+Stripe, powers ChatGPT checkout), AP2 (Google → FIDO Alliance, signed payment mandates), UCP (Google+Shopify, full discovery→checkout journey in Gemini/AI Mode), NLWeb (Microsoft, NL search endpoint per site). These are about **external agents transacting with a store** — a traffic channel. Hay's storefront assistant is the **on-site experience** — complementary, not competing. Worth tracking; not the mechanism for this feature.

### 2.5 Security (this is the part to take seriously)

Letting an LLM invoke tools inside the shopper's authenticated browser session creates a prompt-injection → real-action path (page content or tool output steering the agent into cart/account actions). Chrome's own agent-security guidance splits mitigations into deterministic guardrails (origin allowlists, user-confirmation gates for consequential actions, tools existing only where the page explicitly registers them) and probabilistic ones (LLM checkers). For Hay: client-side tools should be **merchant-registered only (host page code), schema-validated, rate-limited, logged in the tool ledger like any MCP call, and gated to low-consequence actions** (cart, navigation, form prefill — never payment or account mutation) with the orchestrator's existing enabled-tools policy applying.

---

## Part 3 — What this means for Hay

### 3.1 Where the codebase stands today (verified against source)

- **The widget already runs in the host page's context.** `webchat/src/main.ts` mounts the Vue widget straight into the host DOM (`document.body.appendChild`) — no iframe — and already exposes a host-facing API: `window.HayChat.addContext(key, value)` (plus consent controls). A merchant's page can already push arbitrary context into the conversation. This is the natural home for a tool-registration API, and same-context execution means no postMessage bridge is even required (an iframe migration would change that; see risks).
- **The WS protocol is small, typed, and extensible.** `useWebSocket.ts` handles `connected / identified / message / message_sent / typing / conversation_status_changed / history / error` downstream and `identify / message / typing / load_history` upstream. Adding `tool_call` (server→widget) and `tool_result` (widget→server) events is mechanical. Structured payloads already flow: `PRODUCT_RECOMMENDATION` messages carry product arrays that `MessageList.vue` renders as cards.
- **Server-side tool dispatch has exactly one fork to extend.** The orchestrator loop (`server/orchestrator/run.ts:847-956`) treats every tool as an awaitable call: `toolExecutionService.handleToolExecution(...)`. Inside `server/services/core/tool-execution.service.ts:212-370`, dispatch forks on tool-name shape: unprefixed → in-process `coreToolRegistry`; `pluginId:toolName` → MCP client (local process or remote). A third branch — _client tool → push `tool_call` down the conversation's WebSocket, await `tool_result` with a timeout_ — slots in without touching the orchestrator loop at all. `websocketService.sendToConversation(...)` already exists, and tool-result broadcasting over Redis/WS is already in place (`broadcastMessageUpdate`).
- **Tool discovery is already multi-source.** `execution.layer.ts:196-204` merges core tools with playbook-enabled tools into the planner's schema; session-registered client tools would be a third source, present only while the widget's socket is alive.
- **The plugin manifest has no client-tool concept yet.** `server/types/plugin.types.ts` capabilities: `system`, `document_importer`, `mcp`, `chat_connector`. A `client_tools` capability (or a per-organization webchat setting) would be a small, additive schema change.

### 3.2 The two-lane strategy

**Lane A — session-context bridge (server-side tools + client-side identity). Do this per-platform now.**

The VTEX insight applies to most commerce platforms: _the cart is server state addressable by an ID the host page knows_ (VTEX `orderFormId`, Shopify cart token, WooCommerce session, etc.). So:

1. Merchant snippet calls `HayChat.addContext("cartId", ...)` (and currency, locale, current product page, etc.).
2. Context rides along to the orchestrator (plumbing for context → conversation already exists via `useWidgetContext`).
3. Ordinary **server-side** plugin MCP tools (`nuvemshop:add_to_cart`, `nuvemshop:shipping_quote`, …) act on that cart via the platform's API.
4. The storefront UI reflects the change because it reads the same server-side cart (worst case: on next page interaction; best case: the snippet refreshes the mini-cart after a Hay event).

This is VTEX-parity for cart/shipping on any platform with a cart API, using only existing Hay machinery. **Open verification item for NuvemShop:** confirm what their public API exposes for cart read/write and shipping calculation from a cart/session ID — this determines how much of Lane A NuvemShop can get (not verified in this research).

**Lane B — client-tool registry (the "pseudo-MCP"). Prototype behind a flag.**

For what Lane A can't do — UI actions (navigate, open the cart drawer, prefill checkout fields, highlight a product), headless/client-state carts, and instant visual feedback:

1. **Widget API, WebMCP-shaped on purpose:** `HayChat.registerTool({name, description, inputSchema, execute})`. Same contract as `document.modelContext.registerTool` → later becomes a shim that also registers into WebMCP where available.
2. On `identify`, the widget sends registered tool schemas; the server holds them per-conversation-session (present only while the socket lives).
3. Planner sees them as a third tool source (namespaced, e.g. `client:add_to_cart`).
4. New dispatch branch in `executeToolCall`: emit `tool_call` over the conversation socket, await `tool_result` (timeout ~10s → error result the LLM can react to, mirroring the existing MCP error path). One in-flight client call per conversation.
5. Everything else — tool ledger, message metadata (`toolStatus: RUNNING/SUCCESS/ERROR`), dashboard visibility, `enabled_tools` gating — works unchanged because the branch sits below `handleToolExecution`.

Guardrails from day one: merchant-code-only registration, JSON-Schema validation server-side, no secrets in client tool args (client tools bypass the secret-injection path by design), consequence tier capped (no payment/account tools), and every call logged like an MCP call.

### 3.3 Risks / things that would bite later

- **Disconnect mid-call:** shopper closes the tab while the orchestrator awaits `tool_result` → must degrade to a timeout error, and the LLM already handles tool errors gracefully.
- **If the widget ever moves into an iframe** (a plausible hardening step), same-context execution breaks; the postMessage transport from the MCP-B lineage (`@mcp-b/transports`) is the drop-in answer — another reason to keep the contract MCP-shaped.
- **Prompt injection in shopper messages** becomes higher-stakes once tools act in the shopper's session — the consequence-tier cap is the real defense, not model behavior.
- **WebMCP is not stable yet** (origin trial; WebKit/Mozilla uncommitted). Treat it as the API shape to mirror, not a dependency.

### 3.4 Recommendation

1. **Lane A first** — it's mostly per-platform plugin work on existing machinery and delivers the visible VTEX-style demo (add-to-cart + shipping in chat) fastest. Verify NuvemShop's cart API as the immediate next step.
2. **Prototype Lane B behind a feature flag** with one or two tools (`add_to_cart`, `open_cart`) on a test store, WebMCP-shaped API.
3. **Don't chase ACP/UCP/AP2 yet** — different problem (external agent traffic), worth a quarterly re-check.
4. **WhatsApp lesson from VTEX:** their most complete commerce flow is WhatsApp, not web. Hay already has a WhatsApp channel — Lane A's server-side cart tools work identically there, which the client-side lane never will. Another argument for A-before-B.

---

## Sources

**VTEX:** developers.vtex.com — `implementing-shopping-assistant-in-faststore` (the key technical doc), `headless-cart-and-checkout`, `add-cart-items`, `simulate-a-shopping-cart` · vtex.com — `/products/cx_platform/`, `/gallery-glossary.html`, `/solutions/business-needs/whatsapp-store`, `/en-us/press/weni/` · help.vtex.com — `agent-builder-overview`, `intelligent-search-semantic-search-beta`, `data-insights-agent` · businesswire.com — Vision 2025 PR (2025-08-19), Vision 2026 PR (2026-04-16) · apps.vtex.com — `weni-agentic-ai-318` · github.com/weni-ai/weni-webchannel

**Client-side tools:** github.com/webmachinelearning/webmcp (spec, explainer, declarative API) · developer.chrome.com — `/docs/ai/webmcp`, `/blog/ai-webmcp-origin-trial`, `/docs/agents/security` · github.com/MiguelsPizza/WebMCP + github.com/WebMCP-org (`@mcp-b/*` packages) · modelcontextprotocol.io transports spec + SEP #1005 (dormant postMessage transport) · WebKit standards-positions #670, Mozilla standards-positions #1412 · docs.crisp.chat (Hugo frontend actions) · openai.github.io/chatkit-js · docs.copilotkit.ai · ai-sdk.dev (client-side tool calling)

**Agentic commerce:** openai.com/index/buy-it-in-chatgpt · stripe.com/blog/developing-an-open-standard-for-agentic-commerce · cloud.google.com AP2 announcement · developers.googleblog.com UCP deep-dive · github.com/microsoft/nlweb · shopify.dev storefront-MCP + github.com/Shopify/shop-chat-agent · modernretail.co on the Shopify/OpenAI Instant-Checkout pivot (Mar 2026)

_Sourcing caveat: this environment's egress proxy blocked direct fetches of several primary pages (vtex.com, developer.chrome.com, modelcontextprotocol.io, press wires); facts from those domains were gathered via search-engine retrieval and cross-checked across multiple sources. Items flagged "inference" or "approximate" above could not be verified verbatim._
