import { t, publicProcedure } from "@server/trpc";
import {
  requestHostname,
  isDashboardHost,
  challengeFrameHostname,
} from "@server/lib/webchat-origin";
import { isUnderAttack, recordCreateAttempt } from "@server/services/webchat/under-attack.service";
import {
  webchatExtensionsService,
  type GateOutcome,
} from "@server/services/webchat/webchat-extensions.service";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType, MessageDirection } from "../../../database/entities/message.entity";
import type { Conversation } from "../../../database/entities/conversation.entity";
import { TRPCError } from "@trpc/server";
import { dpopCacheService } from "../../../services/dpop-cache.service";
import {
  publicConversationProofTarget,
  verifyDPoPForRequest,
} from "../../../services/webchat/dpop-proof.service";
import { conversationRepository } from "../../../repositories/conversation.repository";
import { CustomerRepository } from "../../../repositories/customer.repository";
import { OrganizationRepository } from "../../../repositories/organization.repository";
import { createLogger } from "@server/lib/logger";
import { SHOPPING_EVENT_TYPES } from "@server/database/entities/shopping-event.entity";
import { recordProductClick } from "@server/services/shopping-events.service";
import { webchatSettingsService } from "../../../services/webchat/webchat-settings.service";
import { recordWebchatConsent } from "../../../services/webchat/consent-record.service";
import { verifiedCustomerExternalId } from "../../../services/webchat/webchat-identity.service";
import { toPublicAttachments, toPublicMessage } from "../../../services/webchat/public-message";
import {
  PUBLIC_WIDGET_LIMITS,
  isPublicWidgetRateLimited,
} from "../../../services/public-widget-limits";
import {
  WIDGET_ATTACHMENT_MAX_BASE64_LENGTH,
  WIDGET_ATTACHMENT_TYPES,
  WidgetAttachmentRejectedError,
  decodeBase64,
  describeCustomerAttachments,
  storeWidgetAttachment,
} from "../../../services/webchat/widget-attachments";
import {
  VISITOR_CONTEXT_KEY,
  VISITOR_CONTEXT_LIMITS,
  boundContext,
} from "../../../services/core/prompt-data";
import {
  CUSTOMER_LINK_SOURCE,
  CUSTOMER_LINK_SOURCE_KEY,
} from "../../../services/core/customer-identity";
import {
  formSchemaSchema,
  validateResponse,
  renderFormResponseAsText,
  extractCustomerFields,
  type FormSchema,
} from "@hay/form-schema";

const logger = createLogger("public-conversations");

const customerRepository = new CustomerRepository();
const organizationRepository = new OrganizationRepository();

const conversationService = new ConversationService();

// Schema for creating a public conversation with public JWK
const createPublicConversationSchema = z.object({
  organizationId: z.string().uuid(),
  publicJwk: z.object({
    kty: z.string(),
    crv: z.string().optional(),
    x: z.string().optional(),
    y: z.string().optional(),
    n: z.string().optional(),
    e: z.string().optional(),
    alg: z.string().optional(),
    use: z.string().optional(),
  }),
  metadata: z.record(z.string(), z.any()).optional(),
  // The widget's UI locale (BCP-47, e.g. "pt-BR"). Sets the conversation
  // language so the greeting is written in it; unsupported languages are ignored.
  language: z
    .string()
    .max(35)
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
    .optional(),
  context: z.record(z.string(), z.any()).optional(),
  // The store's customer id, linked only when signed by the store's server
  // with the organization's identity secret (D1, webchat-identity.service).
  customerExternalId: z.string().max(255).optional(),
  customerExternalIdSignature: z.string().max(128).optional(),
  isPlayground: z.boolean().optional().default(false),
  // Token from a rendered challenge@1 contribution, or the error code when the
  // challenge could not run. Checked by plugin gates before the conversation exists.
  challengeToken: z.string().max(4096).optional(),
  challengeError: z.string().max(64).optional(),
  preChatForm: z
    .object({
      response: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    })
    .optional(),
});

// Schema for sending messages
const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(PUBLIC_WIDGET_LIMITS.maxMessageLength),
  proof: z.string(), // DPoP proof
  context: z.record(z.string(), z.any()).optional(),
});

// Schema for sending a photo or PDF, with an optional caption (D8-9)
const sendAttachmentSchema = z.object({
  conversationId: z.string().uuid(),
  data: z.string().min(1).max(WIDGET_ATTACHMENT_MAX_BASE64_LENGTH), // base64
  mimeType: z.enum(WIDGET_ATTACHMENT_TYPES),
  filename: z.string().min(1).max(255),
  caption: z.string().max(PUBLIC_WIDGET_LIMITS.maxMessageLength).optional(),
  proof: z.string(), // DPoP proof
  context: z.record(z.string(), z.any()).optional(),
});

// Schema for submitting a CSAT rating
const submitCsatSchema = z.object({
  conversationId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  proof: z.string(), // DPoP proof
});

const recordConsentSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(["grant", "revoke"]),
  mode: z.enum(["strict", "implicit"]),
  conversationId: z.string().uuid().optional(),
});

// Schema for getting messages
const trackProductClickSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(SHOPPING_EVENT_TYPES),
});

const getMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  proof: z.string(), // DPoP proof
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

/**
 * The only metadata keys a shopper's browser may set: what the widget sends
 * about the page. Everything else in conversation metadata is trusted by the
 * server (dryRun, isPlayground, sourceId, runKind, test_mode, channel ids, ...)
 * and decides whether writes are simulated or the conversation is billed, so
 * it never comes from the public widget.
 */
const PUBLIC_METADATA_KEYS = ["source", "url", "referrer", "userAgent", "timestamp"] as const;
const PUBLIC_METADATA_MAX_LENGTH = 2048;

export function publicMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of PUBLIC_METADATA_KEYS) {
    const value = metadata?.[key];
    if (typeof value === "string") kept[key] = value.slice(0, PUBLIC_METADATA_MAX_LENGTH);
  }
  return kept;
}

/**
 * Context set by the page the widget runs on (window.HayChat.addContext). Any
 * visitor can change it, so it is bounded and kept under its own key, apart
 * from the context the business's servers write (server SDK addContext). The
 * prompt shows it as unverified visitor data.
 */
export function withVisitorContext(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!incoming || Object.keys(incoming).length === 0) return null;
  const previous = current?.[VISITOR_CONTEXT_KEY];
  const merged = {
    ...(previous && typeof previous === "object" ? previous : {}),
    ...incoming,
  };
  return {
    ...(current ?? {}),
    [VISITOR_CONTEXT_KEY]: boundContext(merged, VISITOR_CONTEXT_LIMITS),
  };
}

export const publicConversationsRouter = t.router({
  // Create a new public conversation with public key registration
  create: publicProcedure.input(createPublicConversationSchema).mutation(async ({ input, ctx }) => {
    try {
      const organizationId = input.organizationId;

      if (
        await isPublicWidgetRateLimited(
          [
            { rule: "createPerIp", id: clientIp(ctx.ipAddress) },
            { rule: "createPerOrg", id: organizationId },
          ],
          { failClosed: true },
        )
      ) {
        throw tooManyRequests();
      }

      const organization = await organizationRepository.findById(organizationId);
      if (
        !organization ||
        organization.suspendedAt ||
        !(await webchatSettingsService.isEnabled(organizationId))
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Webchat is not available" });
      }

      // Origin is set by the browser and cannot be changed by page scripts, so
      // this stops an org ID from being copied onto another site. It does not
      // stop non-browser clients, which can send any header.
      const hostname = requestHostname(ctx.req.headers);
      if (
        !isDashboardHost(hostname) &&
        !(await webchatSettingsService.isDomainAllowed(organizationId, hostname))
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This website is not allowed to use this chat",
        });
      }

      // Validate the JWK is for ES256
      if (input.publicJwk.kty !== "EC" || input.publicJwk.crv !== "P-256") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Public key must be ECDSA P-256",
        });
      }

      // Validate playground mode is allowed for this organization
      if (input.isPlayground) {
        if (!organization.settings?.isPlayground) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Playground mode is not enabled for this organization",
          });
        }
      }

      // Every address trying to create counts towards the under-attack trigger
      // (D9-10), including the ones the gates then refuse.
      const underAttack = await recordCreateAttempt(organizationId, clientIp(ctx.ipAddress));

      // Plugin gates (e.g. a bot challenge) run before the conversation exists.
      const gate = await webchatExtensionsService.runGates(organizationId, "conversation.create", {
        token: input.challengeToken,
        contributionError: input.challengeError,
        pageHostname: hostname,
        frameHostname: challengeFrameHostname(),
        ip: clientIp(ctx.ipAddress),
        underAttack,
      });
      if (gate.decision === "deny") throw verificationFailed();

      // A signed customerExternalId links the store's customer. Unsigned or
      // wrongly signed, the visitor is anonymous (a fresh customer).
      const customerExternalId = await verifiedCustomerExternalId(
        organizationId,
        input.customerExternalId,
        input.customerExternalIdSignature,
      );
      if (input.customerExternalId && !customerExternalId) {
        logger.info({ organizationId }, "Ignored an unsigned or invalid customerExternalId");
      }
      const signedCustomer = customerExternalId
        ? await customerRepository.findByExternalId(customerExternalId, organizationId)
        : null;

      // The form is the organization's own; a client only sends the answers.
      // Checked first so a bad response leaves nothing behind.
      const preChatValidated = input.preChatForm
        ? await validatePreChatResponse(organizationId, input.preChatForm.response)
        : null;

      // An email typed in a form is a claim, so it never links an existing
      // customer: only the store's signature does. The claim gets its own
      // record, and duplicates surface in the customer merge suggestions.
      const preChatCustomerFields = preChatValidated
        ? extractCustomerFields(
            preChatValidated.schema,
            preChatValidated.response as Record<string, string | number | boolean | null>,
          )
        : null;
      const claimedCustomer =
        !signedCustomer && preChatCustomerFields?.email
          ? await customerRepository.create({
              organization_id: organizationId,
              email: preChatCustomerFields.email,
              name: preChatCustomerFields.name ?? null,
              phone: preChatCustomerFields.phone ?? null,
            } as never)
          : null;
      const customer = signedCustomer ?? claimedCustomer;
      const customerLinkSource = signedCustomer
        ? CUSTOMER_LINK_SOURCE.signature
        : claimedCustomer
          ? CUSTOMER_LINK_SOURCE.preChatEmail
          : null;

      // Create the conversation with the public JWK
      const conversation = await conversationService.createConversation(organizationId, {
        status: "open",
        customer_id: customer?.id ?? null,
        language: input.language || null,
        metadata: {
          ...publicMetadata(input.metadata),
          channel: "web",
          createdAt: new Date().toISOString(),
          ...(input.isPlayground ? { isPlayground: true } : {}),
          ...(gate.results.length > 0 ? { botCheck: botCheckRecord(gate) } : {}),
          ...(customerLinkSource ? { [CUSTOMER_LINK_SOURCE_KEY]: customerLinkSource } : {}),
        },
      });

      // The initial visitor context: the page's context, then the pre-chat
      // form answers (they win on conflict). Both come from the visitor, so
      // both are bounded and shown to the AI as unverified.
      const visitorContext = withVisitorContext(null, {
        ...(input.context ?? {}),
        ...(preChatValidated?.response ?? {}),
      });

      // Update the conversation with web-specific fields
      await conversationRepository.updateById(conversation.id, {
        channel: "web",
        publicJwk: input.publicJwk,
        lastMessageAt: new Date(),
        ...(visitorContext ? { context: visitorContext } : {}),
      });

      // Persist a FORM message recording what was collected, so the transcript
      // and the LLM history both surface the structured data clearly.
      if (preChatValidated) {
        const renderedContent = renderFormResponseAsText(
          preChatValidated.schema,
          preChatValidated.response as Record<string, string | number | boolean | null>,
        );
        await conversation.addMessage({
          content: renderedContent,
          type: MessageType.FORM,
          metadata: {
            ui: {
              kind: "form",
              schema: preChatValidated.schema as unknown as Record<string, unknown>,
              status: "SUBMITTED",
              response: preChatValidated.response,
              submittedAt: new Date().toISOString(),
            },
          },
        });
      }

      // Generate initial nonce for this conversation
      const nonce = await dpopCacheService.generateNonce(conversation.id);

      return {
        id: conversation.id,
        nonce,
        createdAt: conversation.created_at,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      logger.error({ err: error }, "Error creating public conversation");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create conversation",
      });
    }
  }),

  // Get messages for a conversation (requires DPoP proof)
  getMessages: publicProcedure.input(getMessagesSchema).mutation(async ({ input, ctx }) => {
    try {
      if (await isPublicWidgetRateLimited([{ rule: "readPerIp", id: clientIp(ctx.ipAddress) }])) {
        throw tooManyRequests();
      }

      // Verify DPoP proof
      const verified = await verifyDPoPForRequest(
        input.conversationId,
        input.proof,
        publicConversationProofTarget("getMessages", ctx.req.headers.host),
      );

      if (!verified.success) {
        // If we have a new nonce (from expired nonce), return it in a success response with error flag
        if (verified.newNonce && verified.error === "Invalid or expired nonce") {
          return {
            messages: [],
            nonce: verified.newNonce,
            hasMore: false,
            error: "NONCE_EXPIRED",
            errorMessage: verified.error,
          };
        }
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: verified.error || "Invalid DPoP proof",
        });
      }

      // Get the conversation to check if it's being processed
      const conversation = await conversationRepository.findById(input.conversationId);

      // Check if conversation is currently being processed (locked)
      const isTyping = conversation
        ? conversation.processing_locked_until &&
          new Date(conversation.processing_locked_until) > new Date() &&
          conversation.needs_processing === true
        : false;

      // The widget only ever sees customer-facing messages, playground or not.
      const messages = await conversationRepository.getWidgetMessages(input.conversationId);

      // Filter to only return customer-facing messages; files get signed links
      const organizationId = conversation?.organization_id;
      const filteredMessages = await Promise.all(
        messages.slice(input.offset, input.offset + input.limit).map(async (msg) =>
          toPublicMessage(msg, {
            attachments: organizationId
              ? await toPublicAttachments(msg.attachments, organizationId)
              : [],
          }),
        ),
      );

      return {
        messages: filteredMessages,
        nonce: verified.newNonce,
        hasMore: filteredMessages.length === input.limit,
        typing: isTyping,
        status: conversation?.status || "open",
        isClosed: ["closed", "resolved", "unresolved"].includes(conversation?.status ?? ""),
        csatRating: conversation?.csat_rating ?? null,
        error: null,
        errorMessage: null,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      logger.error({ err: error }, "Error getting messages");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get messages",
      });
    }
  }),

  // Send a message to a conversation (requires DPoP proof)
  sendMessage: publicProcedure.input(sendMessageSchema).mutation(async ({ input, ctx }) => {
    try {
      // Per IP before DPoP so a flood never reaches signature verification.
      if (
        await isPublicWidgetRateLimited([{ rule: "messagePerIp", id: clientIp(ctx.ipAddress) }])
      ) {
        throw tooManyRequests();
      }

      // Verify DPoP proof
      const verified = await verifyDPoPForRequest(
        input.conversationId,
        input.proof,
        publicConversationProofTarget("sendMessage", ctx.req.headers.host),
      );

      if (!verified.success) {
        // If we have a new nonce (from expired nonce), return it in a success response with error flag
        if (verified.newNonce && verified.error === "Invalid or expired nonce") {
          return {
            messageId: null,
            nonce: verified.newNonce,
            createdAt: null,
            error: "NONCE_EXPIRED",
            errorMessage: verified.error,
          };
        }
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: verified.error || "Invalid DPoP proof",
        });
      }

      // Per conversation only after the proof checks out, so knowing a
      // conversationId is not enough to spend (and mute) a shopper's budget.
      if (
        await isPublicWidgetRateLimited([
          { rule: "messagePerConversation", id: input.conversationId },
        ])
      ) {
        throw tooManyRequests();
      }

      // Get the conversation instance to use the addMessage method
      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      if (
        await isPublicWidgetRateLimited([
          { rule: "messagePerOrg", id: conversation.organization_id },
          { rule: "messagePerOrgHourly", id: conversation.organization_id },
        ])
      ) {
        throw tooManyRequests();
      }

      const gate = await webchatExtensionsService.runGates(
        conversation.organization_id,
        "message.send",
        {
          pageHostname: requestHostname(ctx.req.headers),
          frameHostname: challengeFrameHostname(),
          ip: clientIp(ctx.ipAddress),
          underAttack: await isUnderAttack(conversation.organization_id),
        },
      );
      if (gate.decision === "deny") throw verificationFailed();

      // Add the message using the entity method which handles cooldown
      const message = await conversation.addMessage({
        content: input.content,
        type: MessageType.CUSTOMER,
        metadata: {
          direction: MessageDirection.IN,
          timestamp: new Date().toISOString(),
        },
      });

      // Merge incoming context into conversation context if provided
      const context = withVisitorContext(conversation.context, input.context);
      if (context) await conversationRepository.updateById(conversation.id, { context });

      return {
        messageId: message.id,
        nonce: verified.newNonce,
        createdAt: message.created_at,
        error: null,
        errorMessage: null,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      logger.error({ err: error }, "Error sending message");
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to send message",
      });
    }
  }),

  // D8-9: the shopper sends a photo or PDF (requires DPoP proof). The file and
  // its message are stored in the conversation's organization in one call.
  sendAttachment: publicProcedure.input(sendAttachmentSchema).mutation(async ({ input, ctx }) => {
    // Per IP before DPoP so a flood never reaches signature verification.
    if (
      await isPublicWidgetRateLimited([{ rule: "attachmentPerIp", id: clientIp(ctx.ipAddress) }], {
        failClosed: true,
      })
    ) {
      throw tooManyRequests();
    }

    // The proof shows the caller holds this conversation's key: it is the
    // ownership check. The organization is the conversation's, never the input's.
    const verified = await verifyDPoPForRequest(
      input.conversationId,
      input.proof,
      publicConversationProofTarget("sendAttachment", ctx.req.headers.host),
    );
    if (!verified.success) {
      if (verified.newNonce && verified.error === "Invalid or expired nonce") {
        return {
          messageId: null,
          nonce: verified.newNonce,
          createdAt: null,
          attachment: null,
          error: "NONCE_EXPIRED",
          errorMessage: verified.error,
        };
      }
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: verified.error || "Invalid DPoP proof",
      });
    }

    if (
      await isPublicWidgetRateLimited(
        [{ rule: "attachmentPerConversation", id: input.conversationId }],
        { failClosed: true },
      )
    ) {
      throw tooManyRequests();
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
    }
    const organizationId = conversation.organization_id;
    // Broadest last, so one conversation's flood only spends its own budget first.
    if (
      await isPublicWidgetRateLimited([{ rule: "attachmentPerOrg", id: organizationId }], {
        failClosed: true,
      })
    ) {
      throw tooManyRequests();
    }

    // Same gate as starting a chat: the organization must still offer webchat.
    const organization = await organizationRepository.findById(organizationId);
    if (
      !organization ||
      organization.suspendedAt ||
      !(await webchatSettingsService.isEnabled(organizationId))
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Webchat is not available" });
    }

    const buffer = decodeBase64(input.data);
    if (!buffer) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file data" });
    }

    let attachment;
    try {
      attachment = await storeWidgetAttachment({
        organizationId,
        buffer,
        mimeType: input.mimeType,
        filename: input.filename,
      });
    } catch (error) {
      if (error instanceof WidgetAttachmentRejectedError) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
      logger.error({ err: error }, "Error storing widget attachment");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to send file" });
    }

    const caption = input.caption?.trim();
    const message = await conversation.addMessage({
      content: caption || describeCustomerAttachments([attachment]),
      type: MessageType.CUSTOMER,
      attachments: [attachment],
      metadata: {
        direction: MessageDirection.IN,
        timestamp: new Date().toISOString(),
        ...(caption ? {} : { mediaPlaceholder: true }),
      },
    });

    const context = withVisitorContext(conversation.context, input.context);
    if (context) await conversationRepository.updateById(conversation.id, { context });

    const [publicAttachment] = await toPublicAttachments([attachment], organizationId);
    return {
      messageId: message.id,
      nonce: verified.newNonce,
      createdAt: message.created_at,
      attachment: publicAttachment ?? null,
      error: null,
      errorMessage: null,
    };
  }),

  // D5-8: the shopper leaves an email at hand-off so the team's reply can reach
  // them after they leave (requires DPoP proof). Email only, with consent.
  setContactEmail: publicProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(255),
        proof: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (
        await isPublicWidgetRateLimited([{ rule: "messagePerIp", id: clientIp(ctx.ipAddress) }])
      ) {
        throw tooManyRequests();
      }

      const verified = await verifyDPoPForRequest(
        input.conversationId,
        input.proof,
        publicConversationProofTarget("setContactEmail", ctx.req.headers.host),
      );
      if (!verified.success) {
        if (verified.newNonce && verified.error === "Invalid or expired nonce") {
          return { saved: false, nonce: verified.newNonce, error: "NONCE_EXPIRED" };
        }
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: verified.error || "Invalid DPoP proof",
        });
      }

      const conversation = await conversationRepository.findById(input.conversationId);
      if (!conversation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const { saveHandoffEmail } = await import("@server/services/web-follow-up.service");
      await saveHandoffEmail(conversation, input.email);

      return { saved: true, nonce: verified.newNonce, error: null };
    }),

  // The shopper rates the support once the conversation has ended (requires
  // DPoP proof). One rating per conversation; a re-submit overwrites it.
  /** The host page's consent decision, kept so it can be demonstrated later. */
  recordConsent: publicProcedure.input(recordConsentSchema).mutation(async ({ input, ctx }) => {
    if (await isPublicWidgetRateLimited([{ rule: "messagePerIp", id: clientIp(ctx.ipAddress) }])) {
      throw tooManyRequests();
    }
    await recordWebchatConsent(input);
    return { recorded: true };
  }),

  submitCsat: publicProcedure.input(submitCsatSchema).mutation(async ({ input, ctx }) => {
    if (await isPublicWidgetRateLimited([{ rule: "messagePerIp", id: clientIp(ctx.ipAddress) }])) {
      throw tooManyRequests();
    }

    const verified = await verifyDPoPForRequest(
      input.conversationId,
      input.proof,
      publicConversationProofTarget("submitCsat", ctx.req.headers.host),
    );
    if (!verified.success) {
      if (verified.newNonce && verified.error === "Invalid or expired nonce") {
        return { saved: false, nonce: verified.newNonce, error: "NONCE_EXPIRED" };
      }
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: verified.error || "Invalid DPoP proof",
      });
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
    }
    if (!["closed", "resolved", "unresolved"].includes(conversation.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Conversation has not ended",
      });
    }

    await conversationRepository.updateById(conversation.id, {
      csat_rating: input.rating,
      csat_rated_at: new Date(),
    });

    return { saved: true, nonce: verified.newNonce, error: null };
  }),

  // A shopper opened a recommended product or followed its buy link. No DPoP
  // proof: see shopping-events.service for what makes a click count.
  trackProductClick: publicProcedure
    .input(trackProductClickSchema)
    .mutation(async ({ input, ctx }) => {
      if (await isPublicWidgetRateLimited([{ rule: "clickPerIp", id: clientIp(ctx.ipAddress) }])) {
        throw tooManyRequests();
      }
      return { recorded: await recordProductClick(input) };
    }),

  // Rotate the keypair for a conversation (requires valid DPoP with old key)
  rotateKeys: publicProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        newPublicJwk: z.object({
          kty: z.string(),
          crv: z.string().optional(),
          x: z.string().optional(),
          y: z.string().optional(),
        }),
        proof: z.string(), // DPoP proof with old key
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (
          await isPublicWidgetRateLimited([
            { rule: "rotateKeysPerIp", id: clientIp(ctx.ipAddress) },
          ])
        ) {
          throw tooManyRequests();
        }

        // Verify DPoP proof with current key
        const verified = await verifyDPoPForRequest(
          input.conversationId,
          input.proof,
          publicConversationProofTarget("rotateKeys", ctx.req.headers.host),
        );

        if (!verified.success) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: verified.error || "Invalid DPoP proof",
          });
        }

        // Validate the new JWK
        if (input.newPublicJwk.kty !== "EC" || input.newPublicJwk.crv !== "P-256") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "New public key must be ECDSA P-256",
          });
        }

        // Update the conversation with the new public key
        await conversationRepository.updateById(input.conversationId, {
          publicJwk: input.newPublicJwk,
        });

        // Generate new nonce for the rotated key
        const nonce = await dpopCacheService.generateNonce(input.conversationId);

        return {
          success: true,
          nonce,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error({ err: error }, "Error rotating keys");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rotate keys",
        });
      }
    }),

  // Submit a response to an in-conversation FORM message (ASK_FORM step).
  // Validates the response against the schema stored on the message, writes
  // the fields into the visitor's context, completes a pre-chat claim record
  // with mapToCustomer fields, mutates the FORM message to SUBMITTED, then
  // re-enqueues the orchestrator so it resumes with the new context.
  submitForm: publicProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        messageId: z.string().uuid(),
        response: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        proof: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (await isPublicWidgetRateLimited([{ rule: "formPerIp", id: clientIp(ctx.ipAddress) }])) {
          throw tooManyRequests();
        }

        const verified = await verifyDPoPForRequest(
          input.conversationId,
          input.proof,
          publicConversationProofTarget("submitForm", ctx.req.headers.host),
        );
        if (!verified.success) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: verified.error || "Invalid DPoP proof",
          });
        }

        const conversation = await conversationRepository.findById(input.conversationId);
        if (!conversation) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
        }

        const { MessageRepository } = await import("../../../repositories/message.repository");
        const messageRepository = new MessageRepository();
        const message = await messageRepository.findById(input.messageId);
        if (!message || message.conversation_id !== conversation.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Form message not found" });
        }
        if (message.type !== MessageType.FORM) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Message is not a form" });
        }
        const ui = message.metadata?.ui;
        if (!ui || ui.kind !== "form" || !ui.schema) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Form message has no schema" });
        }
        if (ui.status === "SUBMITTED") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Form already submitted" });
        }

        const schemaParsed = formSchemaSchema.safeParse(ui.schema);
        if (!schemaParsed.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Stored form schema is invalid",
          });
        }
        const schema = schemaParsed.data as FormSchema;

        const validated = validateResponse(schema, input.response);
        if (!validated.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid form response: ${JSON.stringify(validated.errors)}`,
          });
        }

        // The answers come from the visitor, so they sit with the other
        // visitor-supplied context and reach the AI as unverified.
        const context = withVisitorContext(conversation.context, validated.data);
        if (context) await conversationRepository.updateById(conversation.id, { context });

        await fillClaimedCustomer(conversation, schema, validated.data);

        // Mutate the FORM message in place.
        const renderedContent = renderFormResponseAsText(
          schema,
          validated.data as Record<string, string | number | boolean | null>,
        );
        await messageRepository.update(message.id, {
          content: renderedContent,
          metadata: {
            ...(message.metadata ?? {}),
            ui: {
              kind: "form",
              schema: ui.schema,
              status: "SUBMITTED",
              response: validated.data,
              submittedAt: new Date().toISOString(),
            },
          },
        } as never);

        // Re-enqueue orchestrator so it resumes with the new context.
        const { orchestratorQueueService } =
          await import("../../../services/orchestrator-queue.service");
        await orchestratorQueueService.enqueue(
          conversation.id,
          conversation.organization_id,
          "form_submission",
        );

        return {
          messageId: message.id,
          nonce: verified.newNonce,
          submittedAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error({ err: error }, "Error submitting form");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to submit form",
        });
      }
    }),
});

/** The organization's pre-chat form with the answers checked against it. */
async function validatePreChatResponse(
  organizationId: string,
  response: Record<string, string | number | boolean | null>,
): Promise<{ schema: FormSchema; response: Record<string, unknown> }> {
  const { preChatForm: schema } = await webchatSettingsService.getSettings(organizationId);
  if (!schema) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No pre-chat form is configured" });
  }
  const result = validateResponse(schema, response);
  if (!result.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid pre-chat form response: ${JSON.stringify(result.errors)}`,
    });
  }
  return { schema, response: result.data };
}

/**
 * Form answers may complete the record made from a pre-chat claim, and only
 * its empty fields. A record the visitor did not create is never changed.
 */
async function fillClaimedCustomer(
  conversation: Conversation,
  schema: FormSchema,
  response: Record<string, unknown>,
): Promise<void> {
  if (
    !conversation.customer_id ||
    conversation.metadata?.[CUSTOMER_LINK_SOURCE_KEY] !== CUSTOMER_LINK_SOURCE.preChatEmail
  ) {
    return;
  }
  const customer = await customerRepository.findByIdAndOrganization(
    conversation.customer_id,
    conversation.organization_id,
  );
  if (!customer) return;
  const fields = extractCustomerFields(
    schema,
    response as Record<string, string | number | boolean | null>,
  );
  const updates: Record<string, string> = {};
  if (fields.name && !customer.name) updates.name = fields.name;
  if (fields.phone && !customer.phone) updates.phone = fields.phone;
  if (Object.keys(updates).length > 0) {
    await customerRepository.update(customer.id, conversation.organization_id, updates as never);
  }
}

function clientIp(ipAddress: string | undefined): string {
  return ipAddress || "Unknown";
}

function tooManyRequests(): TRPCError {
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please wait a moment and try again.",
  });
}

/** Machine-readable refusal the widget maps to a "could not verify" message. */
export const VERIFICATION_FAILED = "VERIFICATION_FAILED";

function verificationFailed(): TRPCError {
  return new TRPCError({ code: "FORBIDDEN", message: VERIFICATION_FAILED });
}

/** What the conversation keeps from a gate run (read by the spam detector). */
function botCheckRecord(gate: GateOutcome) {
  return {
    decision: gate.decision,
    results: gate.results,
    checkedAt: new Date().toISOString(),
  };
}

// Public components of an EC JWK used for DPoP proof verification.
