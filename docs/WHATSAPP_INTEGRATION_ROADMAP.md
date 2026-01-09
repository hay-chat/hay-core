# WhatsApp Integration Roadmap

This document outlines the steps needed to implement WhatsApp as the first channel plugin in Hay.

## Business Model Decision

We're going with the **Tech Provider (ISV) Model**:

- Customers own their own Meta Business account and WhatsApp Business Account (WABA)
- Customers pay Meta directly for per-message fees
- Hay provides the software layer (AI agent, automation, dashboard)
- Hay charges subscription fee for the platform

This approach is:

- Faster to market (no BSP certification needed)
- Lower risk (customer owns their number, not us)
- Aligns with Hay's open-source philosophy

---

## Phase 1: Meta Setup & Webhook Reception

### 1.1 Meta Developer Console Configuration

**Prerequisites (already done):**

- [x] Meta App created
- [x] App ready for review

**Steps to complete:**

1. **Configure Webhook URL** in Meta Developer Console → WhatsApp → Configuration:

   ```
   Callback URL: https://{hay-domain}/v1/webhooks/whatsapp
   Verify Token: {generate a secret token - store in env}
   ```

   **Note:** Meta only allows ONE webhook URL per app. All customers' messages route to this single endpoint. We identify the organization from the `phone_number_id` in the payload.

2. **Subscribe to Webhook Fields:**
   - `messages` - incoming messages from customers
   - `message_status` - delivery receipts (sent, delivered, read)
   - `message_template_status_update` - for template messages (future)

3. **Get Test Credentials** from WhatsApp → Getting Started:
   - Phone Number ID
   - WhatsApp Business Account ID (WABA)
   - Access Token (temporary test token)

4. **Add Test Phone Numbers** (up to 5 before app review)

### 1.2 Webhook Verification Endpoint

Meta verifies ownership of your webhook URL with a GET request:

```
GET /v1/webhooks/whatsapp
    ?hub.mode=subscribe
    &hub.verify_token={your_verify_token}
    &hub.challenge={random_string}
```

**Implementation requirements:**

- Verify `hub.verify_token` matches the app-level verify token (from env)
- Return `hub.challenge` as plain text response
- Return 200 status code

### 1.3 Webhook Message Handler

After verification, messages arrive as POST requests:

```
POST /v1/webhooks/whatsapp
Headers:
  X-Hub-Signature-256: sha256={signature}
Body: { webhook payload }
```

**Implementation requirements:**

- Validate HMAC-SHA256 signature using app secret
- Return 200 OK **immediately** (within 5 seconds)
- Extract `phone_number_id` from payload to identify organization
- Process message asynchronously (queue it)

### 1.4 Organization Lookup from Webhook

Since the webhook is global, we need to identify which organization owns the phone number:

```
Webhook received with phone_number_id in payload
      │
      ▼
Query: SELECT * FROM plugin_instances
       WHERE config->>'phoneNumberId' = :phoneNumberId
      │
      ▼
Get organization_id from plugin instance
      │
      ▼
Process message for that organization
```

### 1.5 Plugin Configuration Schema

The WhatsApp plugin needs these config fields:

| Field           | Type               | Description                  |
| --------------- | ------------------ | ---------------------------- |
| `accessToken`   | string (encrypted) | Meta Graph API access token  |
| `phoneNumberId` | string             | WhatsApp Phone Number ID     |
| `wabaId`        | string             | WhatsApp Business Account ID |

**App-level config** (in environment variables, shared across all orgs):

| Field                   | Type   | Description                |
| ----------------------- | ------ | -------------------------- |
| `WHATSAPP_APP_ID`       | string | Meta App ID                |
| `WHATSAPP_APP_SECRET`   | string | For signature validation   |
| `WHATSAPP_VERIFY_TOKEN` | string | Webhook verification token |

---

## Phase 2: Message Processing

### 2.1 Parse Meta's Webhook Payload

Meta's payload structure is deeply nested:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "WABA_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15551234567",
              "phone_number_id": "PHONE_NUMBER_ID"
            },
            "contacts": [
              {
                "profile": { "name": "Customer Name" },
                "wa_id": "15559876543"
              }
            ],
            "messages": [
              {
                "from": "15559876543",
                "id": "wamid.HBgLMTU...",
                "timestamp": "1677721234",
                "type": "text",
                "text": { "body": "Hi, I need help" }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

**Extract:**

- `entry[0].changes[0].value.metadata.phone_number_id` → identify organization
- `entry[0].changes[0].value.messages[0].from` → customer's phone number
- `entry[0].changes[0].value.contacts[0].profile.name` → customer display name
- `entry[0].changes[0].value.messages[0].id` → WhatsApp message ID (for deduplication)

**Note:** One webhook can contain multiple entries/changes/messages (batching).

### 2.2 Customer & Conversation Flow

```
Webhook received
      │
      ▼
Extract phone_number_id → lookup organization
      │
      ▼
Find/Create Customer by phone number (using Customer.phone field)
      │
      ▼
Find active conversation for customer + channel
      │
      ├── Found? → Add message to existing conversation
      │
      └── Not found? → Create new conversation
                       Assign to agent mapped to this channel
      │
      ▼
Create Message record with channel = "whatsapp"
      │
      ▼
Trigger Orchestrator
```

**Customer lookup uses the `phone` field:**

```typescript
// Find customer by phone number
const customer = await customerRepository.findOne({
  where: {
    organization_id: organizationId,
    phone: customerPhone, // Use phone field, not external_id
  },
});

// If not found, create with phone
if (!customer) {
  customer = await customerRepository.create({
    organization_id: organizationId,
    phone: customerPhone,
    name: contactName,
    external_metadata: {
      whatsapp: {
        wa_id: waId,
        firstSeenAt: new Date(),
      },
    },
  });
}
```

**Why phone instead of external_id:**

- Phone numbers are universal identifiers
- If someone chats via web and gives their phone, then messages on WhatsApp, we can match them
- `external_id` is for platform-specific IDs without semantic meaning (Instagram IGID, Slack user ID)

**Conversation lifecycle:**

- Active until explicitly closed OR 24h of inactivity
- The 24-hour window aligns with WhatsApp's free service window

### 2.3 Integration Points

- **Customer Service**: Find/create customer by phone number
- **Conversation Service**: Find/create conversation, determine agent
- **Message Service**: Create message, trigger orchestrator
- **Orchestrator**: Process with AI, generate response

---

## Phase 3: Outbound Messaging

### 3.1 SDK Channel Registration (Not MCP)

Outbound messaging uses the **SDK channel pattern**, not MCP tools.

**Why not MCP:**

- MCP tools are for AI agent capabilities (check inventory, send email, create ticket)
- Sending a WhatsApp reply is not an AI decision - the system knows the conversation is on WhatsApp
- The AI generates the response content, but the routing is deterministic

**SDK Channel Pattern:**

```typescript
// In the plugin's entry point: plugins/whatsapp/src/index.ts
import { PluginSDK } from "@hay/plugin-sdk";

const sdk = new PluginSDK();

sdk.channel.register({
  name: "whatsapp",

  // Called when the system needs to send a message on this channel
  onSendMessage: async (params: {
    conversationId: string;
    customerId: string;
    customerPhone: string;
    content: string;
    contentType: "text" | "image" | "document";
    pluginConfig: PluginInstanceConfig;
  }) => {
    const response = await sendToWhatsApp({
      phoneNumberId: params.pluginConfig.phoneNumberId,
      accessToken: params.pluginConfig.accessToken,
      to: params.customerPhone,
      message: params.content,
    });

    return {
      success: response.ok,
      externalMessageId: response.data?.messages?.[0]?.id,
      error: response.ok ? undefined : response.error,
    };
  },
});
```

**How the core system uses this:**

```typescript
// In the orchestrator, after AI generates a response
const conversation = await getConversation(conversationId);

// conversation.channel = 'whatsapp'
const channelHandler = channelRegistry.getHandler(conversation.channel);

if (channelHandler) {
  const result = await channelHandler.onSendMessage({
    conversationId,
    customerId: conversation.customer_id,
    customerPhone: conversation.customer.phone,
    content: aiResponse,
    contentType: "text",
    pluginConfig: pluginInstance.config,
  });

  // Update message with delivery result
  await updateMessageDeliveryState(messageId, result);
}
```

### 3.2 Meta Graph API Call

```
POST https://graph.facebook.com/v21.0/{phone_number_id}/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "{customer_phone_number}",
  "type": "text",
  "text": {
    "body": "{message_content}"
  }
}
```

### 3.3 Message Delivery Flow with Error Handling

```
AI generates response
      │
      ▼
Save message to DB with deliveryState = 'pending'
      │
      ▼
Look up channel handler for conversation.channel
      │
      ▼
Call channelHandler.onSendMessage()
      │
      ├── Success → Update message:
      │             deliveryState = 'sent'
      │             externalMessageId = response.id
      │
      └── Failure → Update message:
                    deliveryState = 'failed'
                    metadata.deliveryFailure = {
                      reason: error.message,
                      errorCode: error.code,
                      timestamp: new Date(),
                      retryCount: 0
                    }
```

### 3.4 Delivery State Enum

```typescript
enum DeliveryState {
  PENDING = "pending", // Message created, send in progress
  QUEUED = "queued", // In test mode, waiting for approval
  SENT = "sent", // Successfully sent to channel API
  DELIVERED = "delivered", // Confirmed received (status webhook)
  READ = "read", // Confirmed read (status webhook)
  FAILED = "failed", // Send attempt failed
}
```

### 3.5 Dashboard UX for Failed Messages

- Show red indicator on failed messages
- Display error reason on hover/click
- Provide "Retry" button for failed messages
- Show delivery status icon (pending, sent, delivered, read, failed)

---

## Phase 4: Embedded Signup (Customer Onboarding)

This is the smooth OAuth flow that lets customers connect their WhatsApp in a few clicks.

### 4.1 Meta App Configuration

Required environment variables:

- `WHATSAPP_APP_ID` - Your Meta App ID
- `WHATSAPP_APP_SECRET` - Your Meta App Secret
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token
- `WHATSAPP_CONFIGURATION_ID` - Configuration ID for Embedded Signup (optional)

### 4.2 Frontend OAuth Flow

```
Customer clicks "Connect WhatsApp"
      │
      ▼
Open Meta OAuth popup (Facebook Login SDK)
      │
      ▼
Customer logs into Facebook
      │
      ▼
Customer selects/creates Meta Business Portfolio
      │
      ▼
Customer selects/creates WABA
      │
      ▼
Customer adds phone number (SMS/call verification)
      │
      ▼
Customer grants permissions to Hay
      │
      ▼
Meta returns access token + phone number ID
      │
      ▼
Hay stores credentials (encrypted) in plugin_instances
      │
      ▼
Done! Customer can receive/send WhatsApp messages
```

### 4.3 Post-Signup Auto-Configuration

After receiving OAuth tokens, Hay should automatically:

1. Store encrypted credentials in plugin instance config
2. Webhook is already configured at app level (global URL)
3. Verify the phone number ID can receive test messages
4. Mark plugin instance as active

---

## Phase 5: App Review & Production

### 5.1 Requirements for Meta App Review

- **Business Verification**: Upload business documents, verify domain
- **Privacy Policy**: Public URL explaining data handling
- **Demo Video**: Screen recording showing the integration working
- **Use Case Description**: Explain what the bot does

**Timeline:** 1-3 weeks typically

### 5.2 Before App Review (Testing Limitations)

- Limited to 5 recipient phone numbers
- Test phone number provided by Meta
- Full functionality, just limited reach

### 5.3 After App Review (Production)

- Unlimited recipients
- Real phone number
- Full production access

---

## Billing Model Summary

| Who Pays        | What                                           | How                                     |
| --------------- | ---------------------------------------------- | --------------------------------------- |
| Customer → Meta | Per-message fees (marketing/utility messages)  | Payment method in Meta Business Manager |
| Customer → Meta | Nothing for service messages within 24h window | Free                                    |
| Customer → Hay  | Platform subscription                          | Stripe/billing system                   |
| Customer → Hay  | Per-resolution fee                             | Hay billing                             |

**Key insight:** Since Hay focuses on customer service (responding to inbound), most conversations are FREE for customers because they're within the 24-hour service window.

---

## Implementation Order

### Immediate (Phase 1-2)

1. [ ] Webhook verification endpoint (GET handler)
2. [ ] Webhook message handler (POST handler with signature validation)
3. [ ] Organization lookup by phone_number_id from plugin_instances
4. [ ] Basic logging to see incoming messages
5. [ ] Message parsing from Meta's nested payload
6. [ ] Customer lookup/creation by phone number
7. [ ] Conversation lookup/creation with channel = 'whatsapp'
8. [ ] Trigger orchestrator on incoming message

### Next (Phase 3)

9. [ ] SDK channel registration pattern (`sdk.channel.register`)
10. [ ] Channel handler: `onSendMessage` implementation
11. [ ] Meta Graph API integration for sending
12. [ ] DeliveryState tracking (pending → sent/failed)
13. [ ] Dashboard UI for delivery status and failed messages

### Then (Phase 4)

14. [ ] Embedded Signup OAuth flow (frontend)
15. [ ] OAuth callback handler (backend)
16. [ ] Plugin instance creation from OAuth response
17. [ ] Plugin instance activation flow

### Finally (Phase 5)

18. [ ] Status webhooks (delivery/read receipts → update DeliveryState)
19. [ ] Media messages (images, documents, voice)
20. [ ] Retry logic for failed messages
21. [ ] Submit for Meta app review

---

## Key Architecture Decisions

### Webhook URL Structure

```
/v1/webhooks/whatsapp   (global, no org ID)
```

**Why global:** Meta only allows ONE webhook URL per app. All customers' WABAs route to this single endpoint. We identify the organization by looking up the `phone_number_id` from the payload in our `plugin_instances` table.

### Customer Identification

Use the `Customer.phone` field for WhatsApp customers, not `external_id`.

**Why:**

- Phone numbers have semantic meaning and can be matched across channels
- If a customer provides their phone on web chat, we can link them when they message on WhatsApp
- Reserve `external_id` for platform-specific IDs without universal meaning

### Conversation "Active" Definition

A conversation is active until:

- Explicitly closed by agent or automation
- 24 hours of customer inactivity

This aligns with WhatsApp's service window.

### Outbound Messaging Pattern

Use **SDK channel registration**, not MCP tools.

**Why:**

- MCP tools are for AI capabilities (things the AI decides to use)
- Channel routing is deterministic (conversation.channel determines where to send)
- The AI doesn't "decide" to use WhatsApp - the system routes based on channel

### Error Handling

All outbound messages follow this pattern:

1. Save message with `deliveryState = 'pending'`
2. Attempt to send via channel handler
3. Update to `'sent'` or `'failed'` based on result
4. Store failure details in `metadata.deliveryFailure`
5. Show failed messages in dashboard with retry option

### Channel-Specific Logic Location

All WhatsApp-specific logic lives in the plugin:

- Webhook payload parsing
- Signature validation
- Meta Graph API formatting
- Sending implementation

Core Hay only knows:

- There's a channel registry where plugins register handlers
- Conversations have a `channel` field
- Messages have a `deliveryState` field

---

## SDK Channel Interface

```typescript
interface ChannelHandler {
  name: string; // 'whatsapp', 'telegram', 'instagram', etc.

  onSendMessage: (params: SendMessageParams) => Promise<SendMessageResult>;

  // Optional: for channels that need webhook parsing
  onWebhook?: (req: WebhookRequest) => Promise<NormalizedMessage>;

  // Optional: for channels that need signature validation
  validateWebhook?: (req: WebhookRequest) => Promise<boolean>;
}

interface SendMessageParams {
  conversationId: string;
  customerId: string;
  customerPhone?: string; // For phone-based channels
  customerExternalId?: string; // For ID-based channels
  content: string;
  contentType: "text" | "image" | "document" | "audio";
  pluginConfig: Record<string, unknown>;
}

interface SendMessageResult {
  success: boolean;
  externalMessageId?: string;
  error?: {
    message: string;
    code?: string;
  };
}
```

This interface will be reused for Telegram, Instagram, Slack, etc.

---

## References

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Embedded Signup Guide](https://developers.facebook.com/docs/whatsapp/embedded-signup)
- [Webhook Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Hay Channel Plugin Architecture](./CHANNEL_PLUGIN_ARCHITECTURE.md)
