import { t, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType, MessageDirection } from "../../../database/entities/message.entity";
import { TRPCError } from "@trpc/server";
import { dpopCacheService } from "../../../services/dpop-cache.service";
import { conversationRepository } from "../../../repositories/conversation.repository";
import { CustomerRepository } from "../../../repositories/customer.repository";
import { OrganizationRepository } from "../../../repositories/organization.repository";
import { createLogger } from "@server/lib/logger";
import {
  webchatSettingsService,
  matchesAllowedDomains,
} from "../../../services/webchat/webchat-settings.service";
import { config } from "@server/config/env";
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
  metadata: z.record(z.any()).optional(),
  // The widget's UI locale (BCP-47, e.g. "pt-BR"). Sets the conversation
  // language so the greeting is written in it; unsupported languages are ignored.
  language: z
    .string()
    .max(35)
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
    .optional(),
  context: z.record(z.any()).optional(),
  customerExternalId: z.string().optional(),
  isPlayground: z.boolean().optional().default(false),
});

// Schema for sending messages
const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(PUBLIC_WIDGET_LIMITS.maxMessageLength),
  proof: z.string(), // DPoP proof
  method: z.string(),
  url: z.string(),
  context: z.record(z.any()).optional(),
});

// Schema for sending a photo or PDF, with an optional caption (D8-9)
const sendAttachmentSchema = z.object({
  conversationId: z.string().uuid(),
  data: z.string().min(1).max(WIDGET_ATTACHMENT_MAX_BASE64_LENGTH), // base64
  mimeType: z.enum(WIDGET_ATTACHMENT_TYPES),
  filename: z.string().min(1).max(255),
  caption: z.string().max(PUBLIC_WIDGET_LIMITS.maxMessageLength).optional(),
  proof: z.string(), // DPoP proof
  method: z.string(),
  url: z.string(),
  context: z.record(z.any()).optional(),
});

// Schema for getting messages
const getMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  proof: z.string(), // DPoP proof
  method: z.string(),
  url: z.string(),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
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

export const publicConversationsRouter = t.router({
  // Create a new public conversation with public key registration
  create: publicProcedure.input(createPublicConversationSchema).mutation(async ({ input, ctx }) => {
    try {
      const organizationId = input.organizationId;

      if (
        await isPublicWidgetRateLimited([
          { rule: "createPerIp", id: clientIp(ctx.ipAddress) },
          { rule: "createPerOrg", id: organizationId },
        ])
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

      // Create the conversation with the public JWK
      const conversation = await conversationService.createConversation(organizationId, {
        status: "open",
        language: input.language || null,
        metadata: {
          ...publicMetadata(input.metadata),
          channel: "web",
          createdAt: new Date().toISOString(),
          ...(input.isPlayground ? { isPlayground: true } : {}),
        },
      });

      // Update the conversation with web-specific fields
      await conversationRepository.updateById(conversation.id, {
        channel: "web",
        publicJwk: input.publicJwk,
        lastMessageAt: new Date(),
        ...(input.context && Object.keys(input.context).length > 0
          ? { context: input.context }
          : {}),
      });

      // Link customer if customerExternalId is provided
      if (input.customerExternalId) {
        const customer = await customerRepository.findByExternalId(
          input.customerExternalId,
          organizationId,
        );
        if (customer) {
          await conversationRepository.updateById(conversation.id, {
            customer_id: customer.id,
          });
        }
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
  getMessages: publicProcedure.input(getMessagesSchema).mutation(async ({ input }) => {
    try {
      // Verify DPoP proof
      const verified = await verifyDPoPForRequest(
        input.conversationId,
        input.proof,
        input.method,
        input.url,
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

      // Get messages — playground conversations receive all types (including Tool, Document, etc.)
      const isPlayground = conversation?.metadata?.isPlayground === true;
      const messages = isPlayground
        ? await conversationRepository.getMessages(input.conversationId)
        : await conversationRepository.getWidgetMessages(input.conversationId);

      // Filter to only return customer-facing messages; files get signed links
      const organizationId = conversation?.organization_id;
      const filteredMessages = await Promise.all(
        messages.slice(input.offset, input.offset + input.limit).map(async (msg) =>
          toPublicMessage(msg, {
            isPlayground,
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
        input.method,
        input.url,
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
      if (input.context && Object.keys(input.context).length > 0) {
        const merged = { ...(conversation.context ?? {}), ...input.context };
        await conversationRepository.updateById(conversation.id, { context: merged });
      }

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
      await isPublicWidgetRateLimited([{ rule: "attachmentPerIp", id: clientIp(ctx.ipAddress) }])
    ) {
      throw tooManyRequests();
    }

    // The proof shows the caller holds this conversation's key: it is the
    // ownership check. The organization is the conversation's, never the input's.
    const verified = await verifyDPoPForRequest(
      input.conversationId,
      input.proof,
      input.method,
      input.url,
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
      await isPublicWidgetRateLimited([
        { rule: "attachmentPerConversation", id: input.conversationId },
      ])
    ) {
      throw tooManyRequests();
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
    }
    const organizationId = conversation.organization_id;

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

    if (input.context && Object.keys(input.context).length > 0) {
      const merged = { ...(conversation.context ?? {}), ...input.context };
      await conversationRepository.updateById(conversation.id, { context: merged });
    }

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
        method: z.string(),
        url: z.string(),
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
        input.method,
        input.url,
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

      const organizationId = conversation.organization_id;
      const consent = { emailConsentAt: new Date().toISOString(), emailConsentSource: "handoff" };
      const customer = conversation.customer_id
        ? await customerRepository.findByIdAndOrganization(conversation.customer_id, organizationId)
        : null;

      if (customer) {
        await customerRepository.update(customer.id, organizationId, {
          email: input.email,
          external_metadata: {
            ...(customer.external_metadata ?? {}),
            web: {
              ...((customer.external_metadata?.web as Record<string, unknown>) ?? {}),
              ...consent,
            },
          },
        });
      } else {
        const created = await customerRepository.create({
          organization_id: organizationId,
          email: input.email,
          external_metadata: { web: consent },
        });
        await conversationRepository.updateById(conversation.id, { customer_id: created.id });
      }

      return { saved: true, nonce: verified.newNonce, error: null };
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
        method: z.string(),
        url: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // Verify DPoP proof with current key
        const verified = await verifyDPoPForRequest(
          input.conversationId,
          input.proof,
          input.method,
          input.url,
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
});

function clientIp(ipAddress: string | undefined): string {
  return ipAddress || "Unknown";
}

function tooManyRequests(): TRPCError {
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: "Too many requests. Please wait a moment and try again.",
  });
}

/**
 * Hostname of the page that made the request: from Origin, falling back to
 * Referer. Null when neither is a valid URL (e.g. the "null" origin of a
 * sandboxed iframe, or a non-browser client that sends neither).
 */
function requestHostname(headers: Record<string, string | string[] | undefined>): string | null {
  for (const name of ["origin", "referer"]) {
    const value = headers[name];
    if (typeof value !== "string" || !value) continue;
    try {
      return new URL(value).hostname.toLowerCase() || null;
    } catch {
      continue;
    }
  }
  return null;
}

// The Hay.chat dashboard previews the widget (demo page, playground) on its own
// domain, which merchants never add to their allowed list.
function isDashboardHost(hostname: string | null): boolean {
  const dashboardHost = config.domain.dashboard.replace(/:\d+$/, "").toLowerCase();
  return !!hostname && !!dashboardHost && matchesAllowedDomains([dashboardHost], hostname);
}

// Public components of an EC JWK used for DPoP proof verification.
interface EcPublicJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
}

// Helper function to verify DPoP proof for a request
export async function verifyDPoPForRequest(
  conversationId: string,
  proof: string,
  method: string,
  url: string,
): Promise<{ success: boolean; newNonce?: string; error?: string }> {
  try {
    // Dynamically import jose using Function constructor to avoid static analysis
    const importDynamic = new Function("specifier", "return import(specifier)");
    const jose = await importDynamic("jose");

    // Get the conversation to verify the public key
    const conversation = await conversationRepository.findById(conversationId);
    if (!conversation) {
      return { success: false, error: "Conversation not found" };
    }

    // Verify this is a web channel conversation
    if (conversation.channel !== "web") {
      return { success: false, error: "Not a web conversation" };
    }

    // Check if conversation has a registered public key
    if (!conversation.publicJwk) {
      return { success: false, error: "No public key registered" };
    }

    // Parse the JWT to get header and payload
    const payload = jose.decodeJwt(proof);
    const protectedHeader = jose.decodeProtectedHeader(proof);

    // Verify header requirements
    if (protectedHeader.typ !== "dpop+jwt") {
      return { success: false, error: "Invalid token type" };
    }

    if (protectedHeader.alg !== "ES256") {
      return { success: false, error: "Invalid algorithm" };
    }

    if (!protectedHeader.jwk) {
      return { success: false, error: "Missing JWK in header" };
    }

    // Verify the JWK matches the registered one
    const registeredJwk = conversation.publicJwk as EcPublicJwk | null;

    // Compare the essential public key components (x and y for EC keys)
    const receivedJwk = protectedHeader.jwk as EcPublicJwk | undefined;
    if (!receivedJwk || !registeredJwk) {
      return { success: false, error: "Missing JWK" };
    }

    if (
      receivedJwk.kty !== registeredJwk.kty ||
      receivedJwk.crv !== registeredJwk.crv ||
      receivedJwk.x !== registeredJwk.x ||
      receivedJwk.y !== registeredJwk.y
    ) {
      return { success: false, error: "Public key mismatch" };
    }

    // Import the public key for verification
    const publicKey = await jose.importJWK(protectedHeader.jwk, "ES256");

    // Verify the JWT signature
    await jose.jwtVerify(proof, publicKey, {
      typ: "dpop+jwt",
      algorithms: ["ES256"],
    });

    // Verify the claims
    if (payload.htm !== method.toUpperCase()) {
      return { success: false, error: "HTTP method mismatch" };
    }

    if (payload.htu !== url) {
      return { success: false, error: "URL mismatch" };
    }

    // Check time window (±120 seconds)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - payload.iat) > 120) {
      return { success: false, error: "Token outside time window" };
    }

    // Check JTI for replay protection
    const isNewJti = await dpopCacheService.checkAndStoreJTI(payload.jti);
    if (!isNewJti) {
      return { success: false, error: "JTI already used" };
    }

    // Verify and rotate nonce
    const newNonce = await dpopCacheService.verifyAndRotateNonce(conversationId, payload.nonce);

    if (!newNonce) {
      // Generate a new nonce for retry
      const freshNonce = await dpopCacheService.generateNonce(conversationId);
      return { success: false, error: "Invalid or expired nonce", newNonce: freshNonce };
    }

    // Update last message timestamp
    await conversationRepository.updateById(conversationId, {
      lastMessageAt: new Date(),
    });

    return { success: true, newNonce };
  } catch (error) {
    logger.error({ err: error }, "DPoP verification error");
    return { success: false, error: "Verification failed" };
  }
} // restart
