import type { Ref } from "vue";
import type { FormResponse } from "@hay/form-schema";
import type { HayChatConfig, Message } from "@/types";
import { createDPoPProof } from "./useDPoP";

// Loaded on demand from useChat when the shopper submits an in-conversation
// form (ASK_FORM): few conversations carry one, and the chat chunk is at its
// size budget.

interface Keypair {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}

/**
 * Submit a response to a FORM message. Marks the local message as submitted
 * first; the orchestrator resumes server-side and the updated message also
 * flows back over the socket.
 */
export async function submitFormMessage(params: {
  config: HayChatConfig;
  conversationId: string;
  keypair: Keypair;
  nonce: Ref<string | null>;
  messages: Message[];
  messageId: string;
  response: FormResponse;
}): Promise<boolean> {
  const { config, conversationId, keypair, nonce, messages, messageId, response } = params;
  const url = `${config.baseUrl}/v1/publicConversations.submitForm`;
  const proof = await createDPoPProof(
    "POST",
    url,
    keypair.privateKey,
    keypair.publicJwk,
    nonce.value || "initial",
  );
  if (!proof) {
    console.error("[Webchat] Failed to create DPoP proof for form submit");
    return false;
  }

  const msg = messages.find((m) => m.id === messageId);
  if (msg) {
    const ui = msg.metadata?.ui as { schema?: unknown } | undefined;
    msg.metadata = {
      ...(msg.metadata ?? {}),
      ui: {
        kind: "form",
        schema: ui?.schema,
        status: "SUBMITTED",
        response,
        submittedAt: new Date().toISOString(),
      },
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, messageId, response, proof, method: "POST", url }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || "Failed to submit form");
    }
    if (data.result?.data?.nonce) nonce.value = data.result.data.nonce;
    return true;
  } catch (error) {
    console.error("[Webchat] Failed to submit form:", error);
    return false;
  }
}
