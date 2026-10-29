# Context

**Current Task**: WebMCP page tools (Lane B of PR #72) on branch `claude/modest-cray-0i6zh0`: host pages register tools the AI runs in the visitor's browser; Hay's dashboard registers its own tools as the demo. Plan + results: `tasks/webmcp-page-tools.md`; integrator guide: `webchat/PAGE_TOOLS.md`.

**Key Decisions**:

- Tools are namespaced `page:<name>`, exempt from `enabled_tools`, no merchant approval gate (visitor's own browser, no provider, no secrets); every call still logged.
- WebMCP-shaped API (`navigator.modelContext` shim/tee + `window.HayChat.registerTool`), MCP-shaped results.
- Kill switch `WEBCHAT_PAGE_TOOLS=false`; the chat chunk sits at 47.2 KB of its 48 KB brotli budget.

**Next Steps**:

- Live end-to-end check on `/demo/web-embed` ("take me to the playbooks page") with a running server.
- Plugin capability `pageTools` (storefront scripts shipping `add_to_cart` etc. for Shopify/Nuvemshop).
- Per-org switch in Settings > Webchat and a page-tools listing in the conversation view.
