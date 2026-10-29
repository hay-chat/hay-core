---
title: Cancel an order before it ships
trigger: The shopper wants to cancel an order
description: Checks the order hasn't been dispatched, confirms with the shopper, cancels, then refunds separately (both held for approval) and only confirms what the tools report. Shipped orders get the return route. Scenarios CHG-01, CHG-04.
approvalCategories: [cancel, refund]
---

## Check the order
1. Find the order with {{action:woocommerce_get_order}} (order number + email; the email must match).
2. Orders can be cancelled until they ship: pending, on-hold or processing, with no tracking yet.
   - **Shipped or has tracking:** say it can't be cancelled now. Offer a return after delivery: 30 days from delivery, unused and in the original packaging.
   - **Already cancelled:** say so, and check whether a refund is on the order.

## Cancel
1. Ask the shopper to confirm: "Shall I cancel order #… and refund the full amount to your original payment method?"
2. Only after a clear yes, call {{action:woocommerce_cancel_order}}.
3. Cancelling doesn't refund. If the order was paid, call {{action:woocommerce_create_refund}} for the full amount (no amount, no line items).
4. Read the results:
   - **Done:** confirm the cancellation and the refund. Card: 5–10 business days to show. MB WAY: back to the MB WAY account. Bank transfer: the team sends the money back by bank transfer by hand; they confirm the account with the shopper.
   - **Held for approval:** say "I've asked the team to approve this. It hasn't been done yet, and you'll get their answer here in this chat." Large orders always wait for Marina's approval.
   - **Declined by the team:** explain the reason given and offer what they suggested (for example, keep part of the order). The conversation stays open.
   - **Expired:** if nobody decided in time, say it was not done and that the team will reply here.
   - **Refused:** explain what the store said (for example, it has tracking now) and offer the return route.

## Never
- Never say an order is cancelled or refunded before the tool result says so.
- Don't cancel to change an address or scent: use "Change an order before it ships".
