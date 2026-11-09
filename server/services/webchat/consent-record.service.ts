import { AppDataSource } from "@server/database/data-source";

export interface WebchatConsentEvent {
  organizationId: string;
  action: "grant" | "revoke";
  mode: "strict" | "implicit";
  conversationId?: string;
}

/**
 * Store a visitor's consent decision. No IP address or browser data, so it
 * stays non-personal. An unknown organization stores nothing, and a
 * conversation of another organization is dropped from the record.
 */
export async function recordWebchatConsent(event: WebchatConsentEvent): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO webchat_consent_events (organization_id, conversation_id, action, mode)
     SELECT o.id,
            (SELECT c.id FROM conversations c WHERE c.id = $2::uuid AND c.organization_id = o.id),
            $3, $4
     FROM organizations o WHERE o.id = $1::uuid`,
    [event.organizationId, event.conversationId ?? null, event.action, event.mode],
  );
}
