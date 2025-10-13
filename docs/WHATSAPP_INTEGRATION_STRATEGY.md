# WhatsApp Integration Strategy for Hay Cloud

## Executive Summary

This document outlines the strategy for integrating WhatsApp Business Platform into Hay using Meta's **Embedded Signup** approach. This provides a seamless 1-click setup experience for customers while maintaining Hay's multi-tenant architecture.

## Strategy Overview

### Phase 1: Tech Provider with Embedded Signup (Launch Phase)

- **Goal**: Simplify WhatsApp setup to < 5 minutes with 1-click experience
- **Approach**: Become a Meta Tech Provider and implement Embedded Signup
- **Billing**: Customers billed directly by Meta for WhatsApp usage
- **Timeline**: 4-6 weeks to launch
- **Risk**: Low (no financial liability, proven approach)

### Phase 2: Solution Partner with Managed Billing (Scale Phase)

- **Goal**: Unified billing and revenue from WhatsApp usage markup
- **Approach**: Upgrade to Solution Partner status
- **Billing**: Hay manages line of credit and bills customers with markup
- **Timeline**: 6-12 months after Phase 1 launch
- **Risk**: Medium (requires financial capacity and Meta approval)

## Why Embedded Signup?

### Current Pain Point (DIY Setup)

```
Customer must:
1. Go to Meta Business Manager (30+ min setup)
2. Create Business Account
3. Create Meta App
4. Add WhatsApp Product
5. Get phone number from Meta
6. Set up payment method with Meta
7. Configure webhooks manually
8. Copy credentials to Hay
9. Test connection
```

### With Embedded Signup

```
Customer experience:
1. Click "Enable WhatsApp" in Hay dashboard
2. Authenticate with Facebook in popup (OAuth)
3. Done! ✅ (< 5 minutes)
```

### Benefits

- ✅ **Simplified onboarding**: 1-click instead of 9+ steps
- ✅ **Faster time-to-value**: Minutes instead of hours
- ✅ **Reduced support burden**: No manual credential setup
- ✅ **Professional experience**: Seamless like Slack/Stripe integrations
- ✅ **Higher conversion**: Fewer drop-offs during setup
- ✅ **Multi-tenant ready**: Each org gets isolated WhatsApp instance

## Technical Architecture

### Multi-Tenant Design

Each organization gets their own:

- WhatsApp Business Account (WABA)
- Phone number from Meta
- Access tokens (encrypted in DB)
- Message routing and conversations
- Usage tracking and billing

```
┌─────────────────────────────────────────────────────┐
│                     Hay Platform                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │   Org A      │  │   Org B      │  │  Org C     │ │
│  │              │  │              │  │            │ │
│  │  WABA: 123   │  │  WABA: 456   │  │ WABA: 789  │ │
│  │  Phone: +1   │  │  Phone: +44  │  │ Phone: +1  │ │
│  │  Token: ***  │  │  Token: ***  │  │ Token: *** │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Meta WhatsApp APIs  │
              └──────────────────────┘
```

### Database Schema

Existing `plugin_instances` table already supports this:

```typescript
{
  id: "uuid",
  organization_id: "org-123",
  plugin_id: "whatsapp-plugin-id",
  enabled: true,
  config: {
    // Encrypted config per organization
    phoneNumberId: "encrypted:123456",
    accessToken: "encrypted:EAA...",
    wabaId: "encrypted:987654",
    webhookVerifyToken: "encrypted:verify123",
    businessAccountId: "encrypted:biz456"
  }
}
```

### Message Flow

```
WhatsApp User sends message
    ↓
Meta WhatsApp Servers
    ↓
Hay Webhook: /plugins/whatsapp/webhook
    ↓
Identify Organization (via phone number ID lookup)
    ↓
Load PluginInstance config for that org
    ↓
Create/Update Contact & Conversation
    ↓
Orchestrator generates AI response
    ↓
Send via Meta API using org's access token
    ↓
WhatsApp User receives response
```

## Implementation Plan

### Prerequisites

#### 1. Become a Meta Tech Provider

- [ ] Create Meta Business Account for Hay
- [ ] Create Meta Developer Account
- [ ] Apply for Tech Provider status through a BSP partner
- [ ] Get Embedded Signup permissions approved
- [ ] Submit App Review for required permissions:
  - `whatsapp_business_management`
  - `whatsapp_business_messaging`

#### 2. Setup Meta App Configuration

- [ ] Create Meta App for Hay
- [ ] Add WhatsApp Product
- [ ] Configure OAuth redirect URIs
- [ ] Set up webhook endpoints
- [ ] Get App ID and App Secret

### Phase 1: Core Plugin Development (Week 1-2)

#### Plugin Structure

```
plugins/whatsapp/
├── manifest.json                 # Plugin metadata & config
├── package.json
├── tsconfig.json
├── index.ts                      # Plugin entry point
├── src/
│   ├── WhatsAppPlugin.ts        # Main plugin class
│   ├── client/
│   │   └── whatsapp-client.ts   # Meta API client
│   ├── handlers/
│   │   ├── webhook.handler.ts   # Webhook message handler
│   │   ├── message.handler.ts   # Message processing
│   │   └── embedded-signup.handler.ts  # OAuth callback handler
│   └── utils/
│       ├── message-mapper.ts    # WhatsApp ↔ Hay message format
│       └── phone-validator.ts   # Phone number utilities
├── ui/
│   ├── configuration.vue        # Settings page
│   └── setup-wizard.vue         # Embedded signup flow UI
└── public/
    └── assets/                  # Static assets
```

#### manifest.json

```json
{
  "$schema": "../base/plugin-manifest.schema.json",
  "id": "hay-plugin-whatsapp",
  "name": "WhatsApp Business",
  "description": "Connect WhatsApp Business with 1-click setup via Embedded Signup",
  "version": "1.0.0",
  "author": "Hay",
  "type": ["channel"],
  "entry": "./dist/index.js",
  "category": "messaging",
  "capabilities": {
    "chat_connector": {
      "type": "webhook",
      "webhooks": [
        {
          "path": "/webhook",
          "method": "POST",
          "verificationToken": true
        },
        {
          "path": "/oauth/callback",
          "method": "GET",
          "verificationToken": false
        }
      ],
      "features": {
        "richMedia": true,
        "typing": false,
        "readReceipts": true,
        "templates": true
      }
    }
  },
  "configSchema": {
    "wabaId": {
      "type": "string",
      "label": "WhatsApp Business Account ID",
      "description": "Your WhatsApp Business Account ID (auto-filled via Embedded Signup)",
      "readonly": true,
      "encrypted": true
    },
    "phoneNumberId": {
      "type": "string",
      "label": "Phone Number ID",
      "description": "Your WhatsApp Business phone number ID (auto-filled)",
      "readonly": true,
      "encrypted": true
    },
    "accessToken": {
      "type": "string",
      "label": "Access Token",
      "description": "WhatsApp Business API access token (auto-filled)",
      "readonly": true,
      "encrypted": true
    },
    "webhookVerifyToken": {
      "type": "string",
      "label": "Webhook Verify Token",
      "description": "Token for webhook verification",
      "default": "auto-generated",
      "encrypted": true
    },
    "businessAccountId": {
      "type": "string",
      "label": "Business Account ID",
      "description": "Meta Business Account ID (auto-filled)",
      "readonly": true,
      "encrypted": true
    }
  }
}
```

### Phase 2: Embedded Signup Implementation (Week 2-3)

#### 1. Frontend Setup Flow

**File: `ui/setup-wizard.vue`**

```vue
<template>
  <div class="whatsapp-setup">
    <div v-if="!configured" class="setup-wizard">
      <h2>Connect WhatsApp Business</h2>
      <p>Set up WhatsApp in under 5 minutes with our 1-click integration</p>

      <div class="setup-steps">
        <div class="step"><CheckCircle /> <span>Authenticate with Facebook</span></div>
        <div class="step">
          <CheckCircle /> <span>Select or create WhatsApp Business Account</span>
        </div>
        <div class="step"><CheckCircle /> <span>Get phone number from Meta</span></div>
        <div class="step"><CheckCircle /> <span>Done! Start messaging</span></div>
      </div>

      <Button @click="startEmbeddedSignup" size="lg"> Connect WhatsApp Business </Button>

      <Alert>
        <AlertCircle />
        <AlertDescription>
          You'll be billed directly by Meta for WhatsApp usage. Pricing starts at
          $0.005/conversation.
        </AlertDescription>
      </Alert>
    </div>

    <div v-else class="configured">
      <!-- Show connected account details -->
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Hay } from "@/utils/api";

const configured = ref(false);

async function startEmbeddedSignup() {
  // Get embedded signup URL from backend
  const { url } = await Hay.plugins.whatsapp.getEmbeddedSignupUrl.query();

  // Open OAuth popup
  const popup = window.open(url, "WhatsApp Setup", "width=600,height=800,scrollbars=yes");

  // Listen for completion
  window.addEventListener("message", async (event) => {
    if (event.data.type === "whatsapp-setup-complete") {
      popup?.close();
      configured.value = true;
      // Refresh plugin configuration
      await loadConfiguration();
    }
  });
}
</script>
```

#### 2. Backend Embedded Signup Handler

**File: `src/handlers/embedded-signup.handler.ts`**

```typescript
import crypto from "crypto";

interface EmbeddedSignupConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export class EmbeddedSignupHandler {
  constructor(private config: EmbeddedSignupConfig) {}

  /**
   * Generate Embedded Signup URL
   */
  generateSignupUrl(organizationId: string): string {
    const state = this.generateState(organizationId);

    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      state: state,
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      extras: JSON.stringify({
        setup: {
          channel: "whatsapp",
        },
      }),
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Handle OAuth callback
   */
  async handleCallback(code: string, state: string) {
    // Verify state and extract organization ID
    const organizationId = this.verifyState(state);

    // Exchange code for access token
    const tokenResponse = await this.exchangeCodeForToken(code);

    // Get WABA and phone number info
    const accountInfo = await this.getAccountInfo(tokenResponse.access_token);

    // Store configuration in plugin instance
    await this.saveConfiguration(organizationId, {
      wabaId: accountInfo.waba_id,
      phoneNumberId: accountInfo.phone_number_id,
      accessToken: tokenResponse.access_token,
      businessAccountId: accountInfo.business_id,
      webhookVerifyToken: crypto.randomBytes(32).toString("hex"),
    });

    // Subscribe to webhooks
    await this.subscribeToWebhooks(accountInfo.waba_id, tokenResponse.access_token);

    return {
      success: true,
      organizationId,
      accountInfo,
    };
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(code: string) {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/oauth/access_token?` +
        `client_id=${this.config.appId}&` +
        `client_secret=${this.config.appSecret}&` +
        `code=${code}&` +
        `redirect_uri=${this.config.redirectUri}`,
    );

    return await response.json();
  }

  /**
   * Get WhatsApp Business Account info
   */
  private async getAccountInfo(accessToken: string) {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/debug_token?` +
        `input_token=${accessToken}&` +
        `access_token=${this.config.appId}|${this.config.appSecret}`,
    );

    const data = await response.json();

    // Extract WABA and phone number from granular scopes
    return {
      waba_id: data.data.granular_scopes.find(
        (s: any) => s.scope === "whatsapp_business_management",
      )?.target_ids[0],
      phone_number_id: data.data.granular_scopes.find(
        (s: any) => s.scope === "whatsapp_business_messaging",
      )?.target_ids[0],
      business_id: data.data.app_id,
    };
  }

  /**
   * Subscribe to webhook events
   */
  private async subscribeToWebhooks(wabaId: string, accessToken: string) {
    await fetch(`https://graph.facebook.com/v18.0/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  private generateState(organizationId: string): string {
    const data = JSON.stringify({
      organizationId,
      timestamp: Date.now(),
    });
    return Buffer.from(data).toString("base64url");
  }

  private verifyState(state: string): string {
    const data = JSON.parse(Buffer.from(state, "base64url").toString());

    // Verify timestamp is recent (within 10 minutes)
    if (Date.now() - data.timestamp > 10 * 60 * 1000) {
      throw new Error("State expired");
    }

    return data.organizationId;
  }
}
```

### Phase 3: Webhook & Messaging (Week 3-4)

#### 1. Webhook Handler

**File: `src/handlers/webhook.handler.ts`**

```typescript
import { Request, Response } from "express";
import { WhatsAppClient } from "../client/whatsapp-client";
import { MessageMapper } from "../utils/message-mapper";

export class WebhookHandler {
  constructor(
    private pluginInstanceRepository: any,
    private orchestratorService: any,
  ) {}

  /**
   * Webhook verification (GET request)
   */
  async verify(req: Request, res: Response) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe") {
      // Find which org this webhook belongs to by matching verify token
      const instance = await this.pluginInstanceRepository.findByConfig({
        webhookVerifyToken: token,
      });

      if (instance) {
        res.status(200).send(challenge);
      } else {
        res.status(403).send("Forbidden");
      }
    } else {
      res.status(400).send("Bad Request");
    }
  }

  /**
   * Handle incoming messages (POST request)
   */
  async handleMessage(req: Request, res: Response) {
    const data = req.body;

    // Acknowledge receipt immediately
    res.status(200).send("OK");

    // Process webhook asynchronously
    this.processWebhook(data).catch(console.error);
  }

  private async processWebhook(data: any) {
    for (const entry of data.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === "messages") {
          await this.handleIncomingMessage(change.value);
        } else if (change.field === "message_status") {
          await this.handleMessageStatus(change.value);
        }
      }
    }
  }

  private async handleIncomingMessage(value: any) {
    const message = value.messages?.[0];
    if (!message) return;

    // Identify organization by phone number ID
    const phoneNumberId = value.metadata.phone_number_id;
    const instance = await this.pluginInstanceRepository.findByConfig({
      phoneNumberId,
    });

    if (!instance) {
      console.error("No organization found for phone number:", phoneNumberId);
      return;
    }

    const organizationId = instance.organization_id;

    // Map WhatsApp message to Hay format
    const hayMessage = MessageMapper.fromWhatsApp(message);

    // Get or create contact
    const contact = await this.getOrCreateContact(
      organizationId,
      message.from,
      value.contacts?.[0],
    );

    // Get or create conversation
    const conversation = await this.getOrCreateConversation(organizationId, contact.id, "whatsapp");

    // Save incoming message
    await this.saveMessage(conversation.id, hayMessage);

    // Generate AI response via orchestrator
    const response = await this.orchestratorService.processMessage({
      organizationId,
      conversationId: conversation.id,
      message: hayMessage.content,
    });

    // Send response back via WhatsApp
    const client = new WhatsAppClient(instance.config.phoneNumberId, instance.config.accessToken);

    await client.sendMessage(message.from, response.content);
  }

  private async handleMessageStatus(value: any) {
    // Handle delivery receipts, read receipts, etc.
    const status = value.statuses?.[0];
    if (!status) return;

    // Update message status in database
    await this.updateMessageStatus(status.id, status.status);
  }

  private async getOrCreateContact(organizationId: string, phoneNumber: string, profile?: any) {
    // Implementation to get/create contact
    // Store WhatsApp phone number as identifier
  }

  private async getOrCreateConversation(
    organizationId: string,
    contactId: string,
    channel: string,
  ) {
    // Implementation to get/create conversation
  }

  private async saveMessage(conversationId: string, message: any) {
    // Implementation to save message
  }

  private async updateMessageStatus(messageId: string, status: string) {
    // Implementation to update message status
  }
}
```

#### 2. WhatsApp API Client

**File: `src/client/whatsapp-client.ts`**

```typescript
export class WhatsAppClient {
  private baseUrl = "https://graph.facebook.com/v18.0";

  constructor(
    private phoneNumberId: string,
    private accessToken: string,
  ) {}

  /**
   * Send text message
   */
  async sendMessage(to: string, text: string) {
    return this.request(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { body: text },
    });
  }

  /**
   * Send media message (image, document, etc.)
   */
  async sendMedia(to: string, type: string, mediaId: string, caption?: string) {
    return this.request(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: type,
      [type]: {
        id: mediaId,
        caption: caption,
      },
    });
  }

  /**
   * Send template message (for business-initiated conversations)
   */
  async sendTemplate(to: string, templateName: string, language: string, components?: any[]) {
    return this.request(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: components || [],
      },
    });
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string) {
    return this.request(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  /**
   * Upload media
   */
  async uploadMedia(fileBuffer: Buffer, mimeType: string) {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("file", new Blob([fileBuffer], { type: mimeType }));

    const response = await fetch(`${this.baseUrl}/${this.phoneNumberId}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: formData,
    });

    return await response.json();
  }

  /**
   * Get media URL
   */
  async getMediaUrl(mediaId: string): Promise<string> {
    const response = await this.request(`/${mediaId}`);
    return response.url;
  }

  /**
   * Download media
   */
  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    return Buffer.from(await response.arrayBuffer());
  }

  private async request(endpoint: string, body?: any) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${data.error?.message || "Unknown error"}`);
    }

    return data;
  }
}
```

### Phase 4: Message Format Mapping (Week 4)

**File: `src/utils/message-mapper.ts`**

```typescript
export class MessageMapper {
  /**
   * Convert WhatsApp message to Hay format
   */
  static fromWhatsApp(whatsappMessage: any) {
    const baseMessage = {
      externalId: whatsappMessage.id,
      timestamp: new Date(parseInt(whatsappMessage.timestamp) * 1000),
      from: whatsappMessage.from,
      channel: "whatsapp",
    };

    switch (whatsappMessage.type) {
      case "text":
        return {
          ...baseMessage,
          type: "text",
          content: whatsappMessage.text.body,
        };

      case "image":
        return {
          ...baseMessage,
          type: "image",
          content: whatsappMessage.image.caption || "",
          media: {
            id: whatsappMessage.image.id,
            mimeType: whatsappMessage.image.mime_type,
            url: null, // Will be fetched separately
          },
        };

      case "document":
        return {
          ...baseMessage,
          type: "document",
          content: whatsappMessage.document.caption || whatsappMessage.document.filename,
          media: {
            id: whatsappMessage.document.id,
            mimeType: whatsappMessage.document.mime_type,
            filename: whatsappMessage.document.filename,
            url: null,
          },
        };

      case "audio":
        return {
          ...baseMessage,
          type: "audio",
          media: {
            id: whatsappMessage.audio.id,
            mimeType: whatsappMessage.audio.mime_type,
            url: null,
          },
        };

      case "location":
        return {
          ...baseMessage,
          type: "location",
          location: {
            latitude: whatsappMessage.location.latitude,
            longitude: whatsappMessage.location.longitude,
            name: whatsappMessage.location.name,
            address: whatsappMessage.location.address,
          },
        };

      default:
        return {
          ...baseMessage,
          type: "unsupported",
          content: `Unsupported message type: ${whatsappMessage.type}`,
        };
    }
  }

  /**
   * Convert Hay message to WhatsApp format
   */
  static toWhatsApp(hayMessage: any) {
    // Convert Hay message format to WhatsApp API format
    // This will be used when sending messages
  }
}
```

### Phase 5: tRPC Routes (Week 4)

**File: `server/routes/v1/plugins/whatsapp.handler.ts`**

```typescript
import { z } from "zod";
import { authenticatedProcedure } from "@server/trpc";
import { EmbeddedSignupHandler } from "@plugins/whatsapp/src/handlers/embedded-signup.handler";

export const getEmbeddedSignupUrl = authenticatedProcedure.query(async ({ ctx }) => {
  const handler = new EmbeddedSignupHandler({
    appId: process.env.META_APP_ID!,
    appSecret: process.env.META_APP_SECRET!,
    redirectUri: `${process.env.APP_URL}/plugins/whatsapp/oauth/callback`,
  });

  const url = handler.generateSignupUrl(ctx.organizationId!);

  return { url };
});

export const handleOAuthCallback = authenticatedProcedure
  .input(
    z.object({
      code: z.string(),
      state: z.string(),
    }),
  )
  .mutation(async ({ input }) => {
    const handler = new EmbeddedSignupHandler({
      appId: process.env.META_APP_ID!,
      appSecret: process.env.META_APP_SECRET!,
      redirectUri: `${process.env.APP_URL}/plugins/whatsapp/oauth/callback`,
    });

    const result = await handler.handleCallback(input.code, input.state);

    return result;
  });
```

### Phase 6: Environment Configuration

**Add to `.env`:**

```bash
# Meta/WhatsApp Configuration
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_WEBHOOK_VERIFY_TOKEN=your_webhook_token

# Public webhook URL (must be HTTPS in production)
WHATSAPP_WEBHOOK_URL=https://yourdomain.com/plugins/whatsapp/webhook
```

### Phase 7: Testing & Quality Assurance (Week 5-6)

#### Test Cases

1. **Embedded Signup Flow**
   - [ ] OAuth popup opens correctly
   - [ ] Facebook authentication works
   - [ ] WABA and phone number are created/selected
   - [ ] Credentials are stored encrypted
   - [ ] Webhooks are subscribed
   - [ ] Success callback redirects properly

2. **Message Receiving**
   - [ ] Text messages are received
   - [ ] Media messages (images, docs) are received
   - [ ] Location messages are received
   - [ ] Messages map to correct organization
   - [ ] Contacts are created/updated
   - [ ] Conversations are created/updated

3. **Message Sending**
   - [ ] Text messages are sent
   - [ ] Media messages are sent
   - [ ] Template messages are sent
   - [ ] Delivery receipts are tracked
   - [ ] Read receipts are tracked

4. **Multi-Tenancy**
   - [ ] Each org has isolated config
   - [ ] Messages route to correct org
   - [ ] No cross-org data leakage

5. **Error Handling**
   - [ ] Invalid tokens handled gracefully
   - [ ] Rate limits respected
   - [ ] Network failures retry
   - [ ] User-friendly error messages

## Deployment Checklist

### Meta Configuration

- [ ] Create Meta Business Account for Hay
- [ ] Create Meta App
- [ ] Add WhatsApp Product to app
- [ ] Submit App Review for permissions
- [ ] Configure OAuth redirect URIs
- [ ] Set up webhook endpoints
- [ ] Get approved as Tech Provider

### Infrastructure

- [ ] Deploy webhook endpoint (must be HTTPS)
- [ ] Configure SSL certificates
- [ ] Set up environment variables
- [ ] Enable webhook subscriptions
- [ ] Configure rate limiting
- [ ] Set up monitoring and alerts

### Database

- [ ] Run plugin installation
- [ ] Verify encryption for sensitive fields
- [ ] Test multi-tenant isolation
- [ ] Set up backup procedures

### Documentation

- [ ] Customer setup guide
- [ ] Troubleshooting guide
- [ ] API documentation
- [ ] Billing/pricing information

## Success Metrics

### Technical Metrics

- Embedded Signup success rate: > 95%
- Message delivery rate: > 99%
- Webhook processing latency: < 500ms
- API error rate: < 1%

### Business Metrics

- Setup completion time: < 5 minutes
- Customer adoption rate: Track % of orgs enabling WhatsApp
- Support ticket volume: < 5% of users need help
- Customer satisfaction: > 4.5/5 rating

### Performance Metrics

- Concurrent message handling: 1000+ msgs/second
- Database query optimization: < 100ms per lookup
- Webhook processing: < 1 second end-to-end

## Cost Analysis

### Development Costs (Phase 1)

- Development time: 4-6 weeks (1 senior developer)
- Meta approval process: 2-4 weeks
- Testing & QA: 1-2 weeks
- **Total**: ~8-12 weeks to launch

### Operational Costs

- Infrastructure: Minimal (webhook endpoint only)
- Meta fees: None (customers billed directly)
- Support overhead: Low (1-click setup reduces tickets)

### Revenue Model (Phase 1: Tech Provider)

- SaaS subscription revenue only
- No WhatsApp usage markup (yet)
- Value proposition: Simplified integration

### Revenue Model (Phase 2: Solution Partner)

- SaaS subscription revenue
- WhatsApp usage markup: 10-20%
- Example: 10K conversations/mo @ $0.03 = $300 → charge $345 → $45 markup/customer
- At 100 customers: $4,500/mo additional revenue

## Risk Mitigation

### Technical Risks

- **Risk**: Meta API changes
  - _Mitigation_: Follow Meta changelog, version APIs properly
- **Risk**: Webhook downtime
  - _Mitigation_: Redundant endpoints, retry logic, monitoring
- **Risk**: Rate limiting
  - _Mitigation_: Implement queuing, respect limits, cache responses

### Business Risks

- **Risk**: Meta approval rejection
  - _Mitigation_: Follow guidelines strictly, provide detailed docs
- **Risk**: Low adoption
  - _Mitigation_: In-app tutorials, customer success outreach
- **Risk**: High support burden
  - _Mitigation_: Comprehensive docs, automated troubleshooting

### Compliance Risks

- **Risk**: Data privacy violations
  - _Mitigation_: Encrypt all tokens, follow GDPR/CCPA, audit regularly
- **Risk**: WhatsApp policy violations
  - _Mitigation_: Implement message templates, respect opt-in/opt-out

## Future Enhancements (Phase 2+)

### Advanced Features

- [ ] WhatsApp message templates management UI
- [ ] Bulk messaging capabilities
- [ ] WhatsApp catalog integration (products)
- [ ] Interactive buttons and lists
- [ ] WhatsApp Pay integration
- [ ] Multi-agent routing
- [ ] Business hours and auto-replies
- [ ] Analytics dashboard (specific to WhatsApp)

### Solution Partner Upgrade

- [ ] Apply for Solution Partner status
- [ ] Implement line of credit management
- [ ] Build unified billing system
- [ ] Add usage tracking and invoicing
- [ ] Migrate existing customers to managed billing

### Integrations

- [ ] CRM sync (Salesforce, HubSpot)
- [ ] E-commerce platforms (Shopify, WooCommerce)
- [ ] Payment processors
- [ ] Calendar scheduling

## Timeline Summary

| Phase                | Duration       | Deliverable                               |
| -------------------- | -------------- | ----------------------------------------- |
| Prerequisites        | 2-4 weeks      | Meta approval, app setup                  |
| Core Plugin          | 2 weeks        | Plugin structure, manifest                |
| Embedded Signup      | 1 week         | OAuth flow, credentials storage           |
| Webhooks & Messaging | 1-2 weeks      | Message handling, API client              |
| Message Mapping      | 1 week         | Format conversion                         |
| Testing & QA         | 1-2 weeks      | Full test coverage                        |
| **Total Phase 1**    | **8-12 weeks** | **Production-ready WhatsApp integration** |
| Phase 2 (Future)     | 6-12 months    | Solution Partner upgrade                  |

## Conclusion

This strategy provides:

✅ **Simplified Setup**: 1-click Embedded Signup (< 5 min vs 30+ min manual)
✅ **Multi-Tenant**: Each org gets isolated WhatsApp instance
✅ **Scalable Architecture**: Handles thousands of concurrent conversations
✅ **Low Risk**: Tech Provider path requires no financial commitment
✅ **Revenue Path**: Clear upgrade to Solution Partner for markup revenue
✅ **Professional UX**: Seamless like Slack/Stripe integrations

**Next Steps:**

1. Get Meta Tech Provider approval
2. Implement Embedded Signup flow
3. Build webhook infrastructure
4. Launch to beta customers
5. Iterate based on feedback
6. Plan Solution Partner upgrade

---

**Document Version**: 1.0
**Last Updated**: 2025-10-05
**Owner**: Hay Engineering Team
