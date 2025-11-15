import { t, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { ConversationService } from "../../../services/conversation.service";
import { MessageType, MessageDirection } from "../../../database/entities/message.entity";
import { TRPCError } from "@trpc/server";
import { dpopCacheService } from "../../../services/dpop-cache.service";
import { conversationRepository } from "../../../repositories/conversation.repository";

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
  language: z.string().optional(),
});

// Schema for sending messages
const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string(),
  proof: z.string(), // DPoP proof
  method: z.string(),
  url: z.string(),
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

export const publicConversationsRouter = t.router({
  // Create a new public conversation with public key registration
  create: publicProcedure.input(createPublicConversationSchema).mutation(async ({ input }) => {
    try {
      const organizationId = input.organizationId;

      // Validate the JWK is for ES256
      if (input.publicJwk.kty !== "EC" || input.publicJwk.crv !== "P-256") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Public key must be ECDSA P-256",
        });
      }

      // Create the conversation with the public JWK
      const conversation = await conversationService.createConversation(organizationId, {
        title: "Web Chat - " + input.metadata?.source,
        status: "open",
        language: input.language || null,
        metadata: {
          ...input.metadata,
          channel: "web",
          createdAt: new Date().toISOString(),
        },
      });

      // Update the conversation with web-specific fields
      await conversationRepository.updateById(conversation.id, {
        channel: "web",
        publicJwk: input.publicJwk,
        lastMessageAt: new Date(),
      });

      // Generate initial nonce for this conversation
      const nonce = await dpopCacheService.generateNonce(conversation.id);

      return {
        id: conversation.id,
        nonce,
        createdAt: conversation.created_at,
      };
    } catch (error) {
      console.error("Error creating public conversation:", error);
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

      // Get messages for the conversation
      const messages = await conversationRepository.getPublicMessages(input.conversationId);

      // Filter to only return customer-facing messages
      const filteredMessages = messages
        .slice(input.offset, input.offset + input.limit)
        .map((msg) => ({
          id: msg.id,
          content: msg.content,
          type: msg.type,
          direction:
            msg.direction ||
            (msg.type === MessageType.CUSTOMER ? MessageDirection.IN : MessageDirection.OUT),
          createdAt: msg.created_at,
          metadata: msg.metadata,
        }));

      return {
        messages: filteredMessages,
        nonce: verified.newNonce,
        hasMore: filteredMessages.length === input.limit,
        typing: isTyping,
        error: null,
        errorMessage: null,
      };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      console.error("Error getting messages:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get messages",
      });
    }
  }),

  // Send a message to a conversation (requires DPoP proof)
  sendMessage: publicProcedure.input(sendMessageSchema).mutation(async ({ input }) => {
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
      console.error("Error sending message:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to send message",
      });
    }
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
        console.error("Error rotating keys:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rotate keys",
        });
      }
    }),
});

// Helper function to verify DPoP proof for a request
async function verifyDPoPForRequest(
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
    const registeredJwk = conversation.publicJwk as any;

    // Compare the essential public key components (x and y for EC keys)
    const receivedJwk = protectedHeader.jwk as any;
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
    console.error("DPoP verification error:", error);
    return { success: false, error: "Verification failed" };
  }
} // restart
