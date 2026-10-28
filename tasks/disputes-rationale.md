# Payment disputes: why, what Hay.chat does, what it never does

For Roger. Written 2026-10-28 from the code on `staging` (Lane C) and `plugins/core/shopify/DISPUTES.md`.
Anything not checked against a real account is marked **unverified**.

## Why a support AI handles disputes at all

A chargeback costs a merchant the sale, the goods already shipped and a dispute fee, and the
response has a hard deadline set by the card network. Small stores often miss it or answer with a
few lines of text. The bank decides on documents: proof the customer was told what they bought,
asked about delivery, got answers, was offered a refund or return. Most of that proof is the
support conversation, and Hay.chat already holds it with timestamps. Building the evidence pack
from those conversations and putting it on the dispute in one click is work only the support tool
can do well. Hay.chat makes no claim that the pack wins. The alert copy and the note on the dispute
state facts about the file only (`server/services/disputes/copy.ts`).

## What Hay.chat does, end to end

1. **Intake.** A plugin with the `disputes` capability reports each dispute to core
   (`pluginApi.disputes.report`). Two plugins do this today:
   - **Stripe**: registers a per-org webhook for `charge.dispute.*` when the API URL is public https,
     syncs disputes from the last 120 days on start, then every 6 h (`0 */6 * * *`).
   - **Shopify Payments**: per-shop `DISPUTES_CREATE` / `DISPUTES_UPDATE` webhooks, a sync on
     start, then every 6 h (`30 */6 * * *`), same 120-day window.
     A webhook body only says which dispute changed. The plugin re-reads that dispute from the
     platform with the merchant's own key or token, so a forged webhook can only trigger a read.
     The report is idempotent per (org, plugin, dispute id).
2. **Order match.** Core looks up the dispute's order references (Stripe: charge/payment-intent
   metadata and description; Shopify: the dispute's order) in the order index. Only orders a
   plugin actually knows count: the reporting plugin's own order first, then any other plugin's.
   An order number that only appears in message text is never used, because another store can
   have the same number (C1). If nothing matches, the dispute is listed without an order and the
   match is retried on later reports and on "Attach".
3. **Alert.** When a dispute needs a response, every active owner and admin gets one email and a
   push notification on their subscribed devices ("opened"), in the org's notification locale, with a link to the Evidence page.
4. **Reminder.** An hourly job sends one more alert when the deadline is within 48 h and nothing has
   been attached.
5. **Evidence pack.** From the conversations linked to the matched order: customer messages, replies
   the customer actually received, tool actions written as plain sentences, receipts and hand-offs.
   Left out: internal and system messages, AI reasoning, scores, simulation and test-mode
   conversations. Card numbers are masked. The template follows the dispute reason (not received,
   not as described, cancelled/credit, generic). It uses whatever the org's retention still keeps.
6. **Attach as draft.** One click on the Evidence page. Core renders the PDF (capped at 3.5 MB for
   the push) and hands it to the plugin, which uploads it into the "customer communication" slot
   (or "uncategorized file") and adds a short `[Hay.chat]` note. Files the merchant added are never
   replaced; if both slots hold merchant files, Hay.chat stops and says so. Every push is written to
   the audit log with `submitted: false`. The merchant can also download the PDF/ZIP and upload it
   by hand.

## What Hay.chat never does

- **It never submits.** Core never asks a plugin to submit, and the push body has no submit field.
  On Stripe the update is sent with `submit=false`. On Shopify, `submitEvidence` is deprecated and
  has no effect, and Hay.chat does not send it.
- **Shopify Payments submits saved evidence itself on the due date.** Shopify's docs say merchants
  must confirm in the Shopify admin to submit _before_ the due date, so a draft Hay.chat saved goes
  to the bank on the deadline. That is why the confirm dialog, the toast after attaching and the
  alert email tell the merchant to review on the platform before the due date. (Not observed on a
  real store: **unverified**.)
- It never writes fraud flags or customer profiling into the evidence, and never says the evidence
  will win.

## Who can do what

| Action                            | Who                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| See the Disputes card on Evidence | Anyone who can read conversations (viewer and up)                        |
| Attach as draft                   | Owners and admins only (it sends customer conversations to the platform) |
| Receive alerts and reminders      | Every active owner and admin                                             |
| Submit the response               | The merchant, on Stripe or in the Shopify admin                          |

## Risks and how each is handled

| Risk                                                      | Handling                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Forged webhook                                            | Body is a hint only; the dispute is re-read with the merchant's credentials. Shopify HMAC is not checked for this reason. |
| Missed or unregistered webhook (e.g. local dev, no https) | 6-hourly sync plus sync on start.                                                                                         |
| Pack attached to the wrong order                          | Plugin-known orders only; text-only mentions never match (C1).                                                            |
| Overwriting the merchant's own evidence                   | Only empty slots or earlier Hay.chat files (`hay-chat-evidence-*`) are used; our note replaces only our earlier note.     |
| Shopify auto-submits a draft the merchant never reviewed  | Copy tells the merchant to review before the due date; 48 h reminder if nothing is attached.                              |
| Alert storm from repeated or racing reports               | Alert and reminder are each claimed once with a conditional update.                                                       |
| Pack too large                                            | Over 3.5 MB the push is refused (`TOO_LARGE`) and the merchant downloads it instead.                                      |
| Missing Shopify scopes                                    | `ACCESS_DENIED` maps to `SCOPE_MISSING`; the rest of the plugin keeps working.                                            |
| Shopify App Review flags the one REST call (file upload)  | Switch to `stagedUploadsCreate` once proven on a dev store.                                                               |

## Still unverified

- **Real Stripe test dispute**: intake, alert and "Attach as draft" have only run in tests and with
  a hand-made staging row (`dp_handtest_1`), never against a Stripe test-mode dispute.
- **Shopify Payments dev store**: nothing in `DISPUTES.md` was run against a real store, including
  the auto-submit on the due date.
- **Protected Shopify scopes**: `read_shopify_payments_disputes`,
  `read_shopify_payments_dispute_evidences` and `write_shopify_payments_dispute_evidences` may need
  Partner Dashboard approval before any store can grant them. They are not yet in
  `hay-shopify-app`'s scopes (planned as a later step after Shopify approves them).
- **Whether Stripe also submits saved evidence at the deadline**: not covered by the code or the
  spike; the copy says "some platforms", so it holds either way.

## Open points found while writing this

- **Stripe's `update_dispute` MCP tool is not held for approval.** The roadmap records
  "update_dispute held", but the Stripe plugin classifies it as `other_write`, and a classified
  `other_write` runs without approval (`server/services/core/action-policy.ts`). If that tool can
  submit evidence, the AI could submit a dispute response in a conversation. Needs a decision.
- **The Spanish alert email** still says the merchant reviews and submits on the platform, without
  the "some platforms send saved evidence automatically on the due date" warning the English and
  Portuguese copy have.
