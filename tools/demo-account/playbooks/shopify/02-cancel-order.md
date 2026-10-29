---
title: Cancel an order before it ships
trigger: The shopper wants to cancel an order
description: Checks the order hasn't shipped, confirms with the shopper, cancels and refunds through the store (held for approval when needed) and only confirms what the tool reports.
approvalCategories: [cancel, refund]
---

## Check the order
1. Find the order with {{action:shopify_get_order_by_name}} (order number + email; the email must match).
2. Read the **supportSummary**. Orders can be cancelled only until they ship.
   - **Already shipped or being fulfilled:** say it can't be cancelled now. Offer a return after delivery: 30 days from delivery, unused and in the original packaging.
   - **Already cancelled:** say so, with the date, and check the refund in the order.

## Cancel
1. Ask the shopper to confirm: "Shall I cancel order #… and refund the full amount to your original payment method?"
2. Only after a clear yes, call {{action:shopify_cancel_order}} with refund and restock on and notify the customer on.
3. Read the result:
   - **Done:** confirm the cancellation and say the card refund shows in 5–10 business days (PayPal: back to the PayPal account).
   - **Held for approval:** say you've asked the team, that the order is not cancelled yet, and that the answer will come in this chat. Large orders always wait for Marina's approval.
   - **Refused (PRECONDITION):** explain what the store said (for example, it has started shipping) and offer the return route.

## Never
- Never say an order is cancelled or refunded before the tool result says so.
- Don't cancel to change an address or scent: use "Change an order before it ships".
