# Hay Context API

The Context API lets you pass information about your end users into Hay conversations. This is how Hay knows who is talking, what permissions they have, and how to authenticate on their behalf when calling your MCP tools.

## The problem it solves

Hay's chat widget runs in your user's browser. By default it knows nothing about who that user is. The Context API is how you bridge your app's identity and auth layer into Hay's orchestration.

Common use cases:

- Your MCP tool needs to act on behalf of the logged-in user (e.g. `myapp:delete-item` needs to know _whose_ item to delete and whether they're allowed)
- You want the AI to greet the user by name, know their plan tier, or behave differently based on their role
- You want to pass context about what page the user is currently on

---

## Two types of context

### Public context

Data that goes into the AI's prompt. The AI can read and reference it in conversation.

```js
HayChat.init({
  organizationId: "org_xxx",
  context: {
    userName: "Sarah Chen",
    plan: "pro",
    currentPage: "/dashboard",
  },
});
```

Public context is sanitized structurally before it reaches the LLM — it is wrapped in delimiters and the model is instructed to treat it as data, not instructions. You should still avoid passing anything sensitive here.

You can update public context at any point during the conversation:

```js
HayChat.addContext("currentPage", "/campaigns/email-builder");
HayChat.addContext("selectedItem", { id: "item_123", name: "Summer Campaign" });
```

### Secrets

Data that is **never sent to the LLM**. Secrets are stored server-side and injected directly into MCP tool call parameters at execution time. The model only knows that a secret exists under a given name — it never sees the value.

Secrets must be attached from your backend, not the browser. See [Attaching secrets](#attaching-secrets) below.

---

## Integration paths

### Path A — Client-only (simplest)

No server involvement. Good for passing page state, user-facing metadata, or anything you're comfortable the AI seeing.

```js
HayChat.init({
  organizationId: "org_xxx",
  baseUrl: "https://api.hay.chat",
  context: {
    userName: "Sarah Chen",
    plan: "pro",
  },
});

// OR

HayChat.init({
  organizationId: "org_xxx",
  baseUrl: "https://api.hay.chat",
});

HayChat.addContext("username", "Sarah Chen");
HayChat.addContext("plan", "pro");
```

**When to use**: Passing non-sensitive user info (names, plan tiers, etc). Do not use this for auth tokens, internal IDs, or anything you would not want appearing in an LLM prompt.

---

### Path B — Server-side secrets

Use this when your MCP tools need to authenticate as the specific user (e.g. OAuth tokens, session credentials, internal user IDs you don't want shared with the LLM).

**Step 1: Add the `onConversationStarted` callback to your widget init**

```js
HayChat.init({
  organizationId: "org_xxx",
  baseUrl: "https://api.hay.chat",

  onConversationStarted: async (conversation) => {
    // Notify your backend that a conversation started for this user.
    // Await this if you want to guarantee secrets are attached before
    // the user can send their first message.
    await myApi.authenticateHay(conversation.id);
  },

  // You can still pass non-sensitive public context client-side
  context: {
    plan: "pro",
  },
});
```

If you return a Promise, the widget input stays disabled until it resolves. If you don't return a Promise, the secrets are attached in parallel and the widget opens immediately — the race window is negligible in practice since the user takes several seconds to type their first message.

**Step 2: Attach secrets from your backend**

Your backend receives the `conversation.id` and calls Hay's API using your org's API key:

```js
// Express example
app.post("/authenticate-hay", async (req, res) => {
  const { conversationId } = req.body;
  const user = req.user; // your authenticated user from session/JWT

  await hay.conversations.addSecrets(conversationId, {
    auth: user.accessToken,
  });

  // Optionally attach trusted public context server-side too
  await hay.conversations.addContext(conversationId, {
    userId: user.id,
    plan: user.plan,
    name: user.name,
  });

  res.sendStatus(200);
});
```

**When to use**: Any time your MCP tools need per-user authentication. This is the recommended path for most production integrations.

---

### Path C — Customer-linked context (persistent)

Use this when you want public context to survive across conversations. Instead of attaching context to a specific conversation, you attach it to a customer record. Hay loads it automatically every time that customer starts a new conversation.

**Secrets are not stored on customer records.** For auth tokens and other credentials, always use Path B's `onConversationStarted` callback — secrets are conversation-scoped only and never written to long-term storage.

**Step 1: Store public context against the customer from your backend**

Call this on user login, signup, or whenever the user's profile changes.

```js
await hay.customers.addContext("ext_usr_456", {
  name: "Sarah Chen",
  plan: "pro",
  accountCreated: "2024-01-15",
});
```

The `externalId` ("ext_usr_456") is your own user ID — whatever you use in your system.

**Step 2: Pass the external ID to the widget**

Inject the user's external ID server-side into your page and pass it to the widget. Hay looks up the customer record and loads their stored context automatically.

```js
HayChat.init({
  organizationId: "org_xxx",
  baseUrl: "https://api.hay.chat",
  customerExternalId: "ext_usr_456", // inject this from your server, not from user input
});
```

You can still layer in ephemeral context client-side and attach per-conversation secrets via `onConversationStarted`:

```js
HayChat.init({
  organizationId: "org_xxx",
  customerExternalId: "ext_usr_456",

  context: {
    currentPage: window.location.pathname, // ephemeral, this conversation only
  },

  onConversationStarted: async (conversation) => {
    // Attach auth secrets for this specific conversation
    await myApi.authenticateHay(conversation.id);
  },
});
```

**When to use**: When user profile data rarely changes and you don't want to re-supply it on every conversation. Best combined with Path B for apps that also need per-conversation secrets.

---

## Choosing the right path

|                    | Path A                               | Path B                               | Path C                                        |
| ------------------ | ------------------------------------ | ------------------------------------ | --------------------------------------------- |
| Server involvement | None                                 | Per conversation                     | Per setup                                     |
| Secrets support    | No                                   | Yes                                  | No                                            |
| Context lifetime   | Conversation                         | Conversation                         | Until you update it                           |
| Setup effort       | Minimal                              | Medium                               | Medium                                        |
| Best for           | Page context, non-sensitive metadata | Auth tokens, per-request credentials | Persistent user profiles, non-sensitive state |

Paths B and C are designed to be combined: use Path C to load the user's stored profile automatically, and add `onConversationStarted` to attach per-conversation secrets on top.

---

## Attaching secrets

All secret operations are server-to-server, authenticated with your Hay API key.

### Conversation-scoped secrets (Path B)

The conversation must already exist. Use `onConversationStarted` to get the ID.

```
POST https://api.hay.chat/v1/conversations/{conversationId}/secrets
Authorization: Bearer hay_sk_...
X-Organization-Id: org_xxx
Content-Type: application/json

{
  "auth": "Bearer eyJhbGciOiJIUzI1NiJ9..."
}
```

Conversation secrets are ephemeral — stored in memory, scoped to the conversation, and discarded when the conversation closes. They are never written to long-term storage.

### Customer context (Path C)

Public context is stored against the customer record using the customer's `externalId`. This is not a secrets endpoint — only non-sensitive data you're comfortable the AI seeing.

```
POST https://api.hay.chat/v1/customers/{externalId}/context
Authorization: Bearer hay_sk_...
X-Organization-Id: org_xxx
Content-Type: application/json

{
  "name": "Sarah Chen",
  "plan": "pro"
}
```

---

## Using context in your playbooks and MCP tools

### Public context in playbooks

Public context values are available to the AI as part of its conversation context. You can reference them in playbook instructions naturally:

> "The user's current plan is available as context. If they ask about features, tailor your response based on their plan."

### Secrets in MCP tool parameters

Your MCP tool schema declares which parameters it expects. When the AI determines a tool should be called, it references available secrets by name using the pattern `<<secret.keyname>>`. Hay's orchestrator intercepts this before the MCP call and substitutes the real value.

**Example MCP tool schema:**

```json
{
  "name": "remove-item-from-list",
  "description": "Removes an item from a list owned by the authenticated user",
  "inputSchema": {
    "type": "object",
    "properties": {
      "listId": { "type": "string" },
      "itemId": { "type": "string" },
      "auth": {
        "type": "string",
        "description": "Bearer token for the authenticated user",
        "x-hay-secret": "auth"
      }
    },
    "required": ["listId", "itemId", "auth"]
  }
}
```

The `x-hay-secret` annotation tells Hay's orchestrator to always inject this parameter from the named secret, regardless of what the AI generates. This is the most reliable method and is recommended for auth parameters.

Without the annotation, the AI will attempt to fill the parameter using `<<secret.auth>>` based on its understanding of the context — this works in most cases but the schema annotation is more deterministic.

**What the AI sees:**

```
Context about this user:
- Name: Sarah Chen
- Plan: pro
- Current page: /lists/my-list

Available secrets: auth, userId
(Secret values are not shown. Reference them as <<secret.auth>> if needed.)
```

**What reaches your MCP tool:**

```json
{
  "listId": "list_789",
  "itemId": "item_123",
  "auth": "Bearer eyJhbGciOiJIUzI1NiJ9..."
}
```

---

## Security notes

- **Public context is sanitized structurally** — values are wrapped in prompt delimiters with instructions to treat them as data. Avoid passing untrusted user input (e.g. values from form fields that a user might intentionally craft) as public context keys you rely on for access control.
- **Secrets never reach the LLM** — the model is told a secret exists under a name but never sees its value. Do not use public context for auth tokens.
- **Conversation-scoped secrets are ephemeral** — stored in memory, never written to the database. If the user opens a new conversation (e.g. after closing the browser), your `onConversationStarted` callback fires again and you re-attach fresh secrets.
- **Customer records store only public context** — no secrets are ever written to the database. If you need per-user credentials, attach them per-conversation via `onConversationStarted`.
- **`conversation.id` is not sensitive** — passing it from the browser to your backend (Path B) does not expose anything meaningful. The DPoP keypair is what authenticates the conversation.
- **`customerExternalId` should come from your server** — inject it into the page server-side rather than deriving it from user input. If a user tampers with it in the browser console, they can only affect their own AI session context (no secrets, no conversation history access).
- **Validate on your side** — Hay does not verify that the user making the widget request is who you say they are. That is your backend's responsibility. Always authenticate the request in your own middleware before calling `addSecrets`.

---

## Full integration example

```html
<!-- your-page.html -->
<script>
  window.HayChat = {
    config: {
      organizationId: "org_xxx",
      baseUrl: "https://api.hay.chat",
      widgetTitle: "Support",

      context: {
        currentPage: window.location.pathname,
      },

      onConversationStarted: async (conversation) => {
        const res = await fetch("/api/hay/authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversation.id }),
        });
        if (!res.ok) console.error("Failed to attach Hay context");
      },
    },
  };
</script>
<script src="https://cdn.hay.chat/widget.js" async></script>
```

```js
// your-server.js
import Hay from "@hay-chat/sdk";

const hay = new Hay({ apiKey: process.env.HAY_API_KEY });

app.post("/api/hay/authenticate", requireAuth, async (req, res) => {
  const { conversationId } = req.body;
  const user = req.user;

  await hay.conversations.addSecrets(conversationId, {
    auth: user.accessToken,
  });

  await hay.conversations.addContext(conversationId, {
    userId: user.id,
    name: user.displayName,
    plan: user.subscriptionTier,
    organizationName: user.org.name,
  });

  res.sendStatus(200);
});
```
