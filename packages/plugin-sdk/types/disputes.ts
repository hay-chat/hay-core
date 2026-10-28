/**
 * Hay Plugin SDK - Payment Dispute Types (chargeback intake + evidence draft)
 *
 * Plugins connected to a payment platform declare the `disputes` capability.
 * They report disputes (chargebacks) to core through `HayStartContext.disputes`
 * and answer core's evidence push on the worker route `POST /disputes/evidence`
 * (`DISPUTE_EVIDENCE_ROUTE`). Core owns the dispute list, the owner
 * alert, the evidence pack and the audit log; the plugin only talks to the
 * payment platform.
 *
 * Rule for every plugin: evidence is attached as a DRAFT. A plugin never
 * submits a dispute response: the merchant reviews and submits it on the
 * payment platform.
 *
 * @module @hay/plugin-sdk/types/disputes
 */

/** Where the dispute stands, normalized from the platform's own status. */
export type DisputeStatusName =
  /** The merchant can still add evidence. */
  | "needs_response"
  /** Evidence was submitted (on the platform) and the bank is deciding. */
  | "under_review"
  | "won"
  | "lost"
  /** Closed without a decision (accepted, refunded, withdrawn, inquiry closed). */
  | "closed";

/** A dispute as the plugin reports it. `source` is stamped by core from the plugin id. */
export interface CanonicalDispute {
  /** The platform's dispute id (e.g. `dp_...`, a Shopify dispute gid). */
  externalId: string;
  status: DisputeStatusName;
  /** Disputed amount in major units ("42.50"). */
  amount?: string;
  /** ISO 4217 code, upper case. */
  currency?: string;
  /** Network reason, snake_case (`product_not_received`, `fraudulent`, ...). */
  reason?: string;
  /** Deadline for evidence, ISO 8601. */
  evidenceDueBy?: string;
  /** When the cardholder opened it, ISO 8601. */
  initiatedAt?: string;
  /**
   * Order references the platform knows for the disputed payment, best first:
   * order ids and order numbers ("1001", "gid://shopify/Order/55"). Core
   * matches them against the conversations that talked about the order.
   */
  orderRefs?: string[];
  /** Human order number to show ("#1001"), when known. */
  orderLabel?: string;
  /** Link to the dispute on the platform's dashboard. */
  providerUrl?: string;
}

/** Runtime API on `HayStartContext.disputes`. */
export interface HayDisputeSourceRuntimeAPI {
  /** Create or update a dispute. Idempotent on (plugin, externalId). */
  report(dispute: CanonicalDispute): Promise<{ created: boolean }>;
}

/**
 * Body of core's POST to the worker route `/disputes/evidence` when the
 * merchant clicks "Attach as draft". Core-only: the public plugin proxy never
 * forwards `/disputes/*`.
 */
export interface DisputeEvidenceRequest {
  /** `CanonicalDispute.externalId`. */
  disputeId: string;
  /** The evidence pack: one PDF of the customer communication. */
  file: { name: string; mimeType: string; base64: string };
  /**
   * A short factual note for the platform's free-text field. Plugins append it
   * to what is already there (or replace their own earlier note), never wipe
   * the merchant's text.
   */
  text: string;
  /** Marker that starts `text`, so a plugin can find and replace its own earlier note. */
  marker: string;
}

/** Codes a plugin answers with when it could not attach the evidence. */
export type DisputeEvidenceErrorCode =
  /** The dispute no longer takes evidence (submitted, closed, past due). */
  | "NOT_EDITABLE"
  /** Every file slot Hay.chat may use already holds someone else's file. */
  | "SLOT_TAKEN"
  /** The connection lacks a permission (e.g. the store must re-approve the app). */
  | "SCOPE_MISSING"
  | "NOT_FOUND"
  | "NOT_CONNECTED"
  | "PROVIDER_ERROR";

export type DisputeEvidenceResponse =
  | { ok: true; providerUrl?: string }
  | { ok: false; code: DisputeEvidenceErrorCode; message: string };
