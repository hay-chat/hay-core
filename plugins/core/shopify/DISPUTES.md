# D2-1 spike: Shopify dispute scopes, evidence API and the deprecated `submitEvidence`

Desk spike from shopify.dev (Admin API 2026-04, the plugin's default `apiVersion`), checked with
Shopify's GraphQL schema validator on 2026-10-28. Nothing here was run against a real store: the
scope grant itself has to be checked on a dev store (see "Needs Roger").

## Answer

- **Hay.chat can attach evidence but never submit it.** `ShopifyPaymentsDisputeEvidenceUpdateInput.submitEvidence`
  is marked Deprecated, and the REST Dispute Evidence page says: "The API can update evidence but
  can't submit it. The submit_evidence parameter has no effect. To submit evidence before the due
  date, merchants must confirm submission in the Shopify admin." That matches Roger's rule (draft
  only, the merchant submits), so D2-8 attaches and stops.
- **Go ahead with D2-8**, behind the re-consent that already bundles the dispute scopes with D6's
  `write_order_edits` (commit 9d28af5). One scope was missing from that bundle:
  `read_shopify_payments_dispute_evidences` (needed to read the existing evidence and its file
  slots, so Hay.chat appends instead of overwriting). D2-8 adds it.

## Scopes

| Scope                                      | Needed for                                                                                    | Source                                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_shopify_payments_disputes`           | `dispute(id:)`, `disputes` list, `disputes/create` + `disputes/update` webhooks               | `ShopifyPaymentsDispute` "Requires read_shopify_payments_disputes"; webhook topic access scope `shopify_payments_disputes`                                     |
| `read_shopify_payments_dispute_evidences`  | `dispute.disputeEvidence { uncategorizedText, customerCommunicationFile, uncategorizedFile }` | validator: "Required scopes: … read_shopify_payments_dispute_evidences"; `ShopifyPaymentsDisputeFileUpload` "Requires read_shopify_payments_dispute_evidences" |
| `write_shopify_payments_dispute_evidences` | `disputeEvidenceUpdate`, dispute file upload                                                  | validator on `disputeEvidenceUpdate`                                                                                                                           |
| `read_orders` (already granted)            | `dispute.order { id name }`                                                                   | validator                                                                                                                                                      |

Shopify also requires the staff member who approves the app to have the `manage_disputes`
permission, and the store must use Shopify Payments (other gateways have no disputes here).
Community threads report "access denied" on the evidence scopes for some apps: they are
protected scopes and may need to be requested for the app in the Partner Dashboard before a
store can grant them. That is the main thing to confirm on a dev store.

## Operations D2-8 uses (validated against the 2026-04 schema)

1. **Intake**: `webhookSubscriptionCreate(topic: DISPUTES_CREATE | DISPUTES_UPDATE, webhookSubscription: { uri, format: JSON })`,
   created per shop by the plugin on start (idempotent: `webhookSubscriptions(topics: [...])` is
   read first). The payload is only a hint: the plugin re-reads the dispute with
   `dispute(id: "gid://shopify/ShopifyPaymentsDispute/<id>")` using the shop's own token, so a
   forged webhook can at most make Hay.chat re-read a real dispute. (No HMAC check is needed for
   that reason; Shopify's HMAC is base64, which core's generic webhook router does not support.)
2. **Read**: `dispute { id legacyResourceId status type evidenceDueBy evidenceSentOn amount { amount currencyCode } reasonDetails { reason networkReasonCode } order { id name legacyResourceId } disputeEvidence { id uncategorizedText customerCommunicationFile { id originalFileName } uncategorizedFile { id originalFileName } } }`.
3. **File upload**: GraphQL has no "create dispute file" mutation. Two documented paths:
   - REST `POST /admin/api/2026-04/shopify_payments/disputes/{dispute_id}/dispute_file_uploads.json`
     with `{ dispute_file_upload: { document_type: "customer_communication_file", filename, mimetype, data: <base64> } }`.
     Returns the upload id and attaches it to that evidence slot. PDF, JPEG or PNG, about 4 MB.
     **D2-8 uses this** because it is the only path documented end to end.
   - `stagedUploadsCreate(resource: DISPUTE_FILE_UPLOAD)`: the enum says "after uploading the file,
     you can add the file to a dispute using the disputeEvidenceUpdate mutation", but no page says
     how a staged `resourceUrl` becomes a `ShopifyPaymentsDisputeFileUpload` id (the input only
     takes `{ id, destroy }`). Untested; see Needs Roger.
4. **Attach**: `disputeEvidenceUpdate(id: <ShopifyPaymentsDisputeEvidence gid>, input: { customerCommunicationFile: { id }, uncategorizedText })`.
   `uncategorizedText` keeps whatever the merchant or Shopify already wrote: Hay.chat appends its
   own block (or replaces only its own earlier block). The file goes into `customerCommunicationFile`
   when that slot is empty or holds an earlier Hay.chat file, else into `uncategorizedFile` under
   the same rule, else Hay.chat stops and asks the merchant to upload by hand.
5. **Never**: `submitEvidence` (deprecated, no effect), any fraud flag or profiling text.

## Risks

- **REST is legacy for new public apps** ("Starting April 1, 2025, all new public apps must be
  built exclusively with the GraphQL Admin API"). If App Review flags the one REST call, switch to
  the staged-upload path once it is proven on a dev store.
- Protected scopes may block the whole re-consent. Mitigation already in place: every dispute call
  maps `ACCESS_DENIED` to `SCOPE_MISSING`, and the rest of the plugin keeps working.
- Per-shop webhook subscriptions: the Shopify app (`hay-shopify-app`) could instead declare the
  `disputes/create` subscription in its TOML; the per-shop subscription works for both managed and
  self-hosted stores without an app release, so D2-8 uses it.

## Needs Roger (dev store)

1. In the Partner Dashboard, request/enable the protected scopes for the Hay.chat app if Shopify
   asks: `read_shopify_payments_disputes`, `read_shopify_payments_dispute_evidences`,
   `write_shopify_payments_dispute_evidences`.
2. Add the three scopes to `hay-shopify-app`'s `shopify.app.toml` `[access_scopes]`, in the same
   release as D6's `write_order_edits` (one re-consent), and deploy the app config.
3. On a dev store with Shopify Payments in test mode: reconnect Shopify in Hay.chat, check the grant
   (Settings > Apps > Hay.chat > permissions), create a test dispute (use the "dispute" card from Shopify Payments' test-mode card list,
   believed to be 4000 0000 0000 0259; check), confirm the dispute appears on Hay.chat's Evidence page, then
   "Attach as draft" and confirm in Shopify admin that the PDF sits in "Customer communication" and
   the note in "Additional information", with nothing submitted.
4. Optional: try `stagedUploadsCreate(resource: DISPUTE_FILE_UPLOAD)` and report whether the staged
   file can be attached, so the REST call can go.
