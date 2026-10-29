# Page tools (WebMCP) for the Hay webchat

A page that embeds the Hay widget can register **tools the AI runs in the visitor's browser**: open
the cart drawer, add a variant, go to a page, point at a button. The shape is the
[WebMCP](https://github.com/webmachinelearning/webmcp) draft (`navigator.modelContext.registerTool`),
so a page written for the standard works with Hay with no extra code, and a page written for Hay
keeps working when browsers ship WebMCP.

While a tool runs the page shows what the AI is doing: an orange frame around the viewport, a pill
with the agent's name and the action, a cursor that travels to the element the tool points at, and a
highlight box with a label.

## Register a tool

`widget.js` loads async, so page code may run before it. Either register from the script's `load`
event, or push onto `window.HayChat.tools`, which works at any time:

```html
<script>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = { organizationId: "YOUR_ORG_ID", baseUrl: "https://api.your-domain.com" };
  (window.HayChat.tools = window.HayChat.tools || []).push({
    name: "add_to_cart",
    description: "Add a product variant to the shopper's cart. Use when they ask to buy or add something.",
    inputSchema: {
      type: "object",
      properties: {
        variantId: { type: "string" },
        quantity: { type: "number", minimum: 1 },
      },
      required: ["variantId"],
    },
    async execute({ variantId, quantity = 1 }) {
      window.HayChat.highlight("#cart-icon", "Adding to cart");
      await store.cart.add(variantId, quantity);
      return { content: [{ type: "text", text: `Added ${quantity} × ${variantId} to the cart.` }] };
    },
  });
</script>
<script src="https://api.your-domain.com/v1/webchat/widget.js" async></script>
```

A page written for the WebMCP standard needs nothing Hay-specific: once `widget.js` has run,
`navigator.modelContext.registerTool(tool)` reaches Hay too (the widget provides the object when the
browser has none, and copies registrations into Hay when it does).

Also available: `window.HayChat.registerTool(tool)`, `window.HayChat.unregisterTool(name)`,
`navigator.modelContext.provideContext({ tools })` (replaces the set registered through
`modelContext`) and `window.HayChat.highlight(elementOrSelector, label?)`.

### The tool object

| Field          | Required | Notes                                                                                                     |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `name`         | yes      | Letters, digits, `_`, `-`, up to 64 chars. The AI sees it as `page:<name>`.                                |
| `description`  | yes      | What it does and when to use it, up to 500 chars. This is what the AI reads to decide.                    |
| `inputSchema`  | no       | JSON Schema for `execute`'s argument. Default `{ "type": "object" }`.                                      |
| `annotations`  | no       | `{ readOnlyHint: true }` for tools that only look or navigate.                                            |
| `execute`      | yes      | Runs in the page with the AI's arguments. Return an MCP result (`{ content: [{ type: "text", text }] }`) or any JSON value. Throw, or return `{ isError: true, content: [...] }`, to report a failure. |

At most 32 tools, 32 KB of descriptors in total. Tools are tied to the open conversation: they are
sent when the socket identifies and again whenever the list changes, and they vanish when the tab
closes. The AI gets 15 seconds for an answer; after that it is told the tool did not answer.

## What the AI sees

The planner prompt lists page tools in their own section ("Page tools (this visitor's browser)")
next to the playbook's tools and Hay's built-in tools. A page tool is never gated by a playbook's
`enabled_tools`; the page decides what is available by registering it. Every call lands in the
conversation's TOOL message, the action log and the tool ledger like an MCP call.

## Safety model

- **Only the page's own code can register tools.** Hay never lets the AI run anything the page did not
  offer, and never injects secrets or approval ids into page tool calls.
- Page tools skip the merchant approval gate (refund caps, customer confirmation): they run in the
  visitor's own browser, in front of the visitor, and touch no provider. Register only what you would
  let the visitor click themselves: cart, navigation, form prefill, "show me where". **Never** payment
  or account mutations.
- Validate arguments in `execute`: the AI fills them from the conversation, so treat them as user input.
- The whole feature can be turned off on the server with `WEBCHAT_PAGE_TOOLS=false`.

## Protocol (for the curious)

| Direction        | Frame                                                   |
| ---------------- | ------------------------------------------------------- |
| widget → server  | `identify` carries `tools: [...]` (descriptors only)     |
| widget → server  | `register_tools { tools }` when the page changes the set |
| server → widget  | `tool_call { callId, name, args }`                       |
| widget → server  | `tool_result { callId, result }` or `{ callId, error }`  |

Server side: `server/services/webchat/page-tools.service.ts` keeps the descriptors (Redis with a TTL,
memory without Redis), publishes `page_tool_call` on `websocket:events` so any instance holding the
socket forwards it, and listens on `webchat:page-tool-results` for answers from another instance.
Dispatch is the `page:` branch in `ToolExecutionService.executeToolCall`.

## Hay's own tools

The dashboard registers its own page tools (`dashboard/composables/usePageTools.ts`) on the
web-embed demo page, so Hay's chat can drive Hay: `describe_page`, `navigate`, `open_conversation`,
`open_settings`, `highlight`. In a browser that ships WebMCP the same tools are registered with
`navigator.modelContext` at app start, for the browser's agent.
