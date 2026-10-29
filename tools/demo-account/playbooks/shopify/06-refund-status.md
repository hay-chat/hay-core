---
title: Where is my refund
trigger: The shopper asks about a refund they're waiting for, or why a refund is smaller than they expected
description: Reads the refunds on the order and gives the real date, amount and payment-method timeline; explains partial refunds item by item; hands off when the timeline has passed. Scenarios RET-05, RET-06.
---

## Look it up

1. Find the order with {{action:shopify_get_order_by_name}} (order number + email; the email must match).
2. Read the refunds on the order: date, amount, which items and the payment gateway.

## Answer

- **Refund made:** give the date and amount exactly as the order shows. Card (Shopify Payments): 5–10 business days to show on the statement after that date; PayPal: back to the PayPal account. Give the date by which it should show.
- **Partial refund:** list which items were refunded and for how much, and what wasn't (for example: one mug refunded after the damage report, the candle wasn't). Use {{action:shopify_calculate_refund}} only if the shopper asks what is still refundable; don't refund anything here.
- **"I want the rest back":** ask why. If an item is faulty or damaged, follow "Damaged or broken item"; otherwise it's a return ("Return an item") or a question for the team. Don't refund it here, and never invent a fee or restocking charge.
- **No refund on the order:** say so plainly. If the shopper expected one (a cancellation, a return, a damage report), hand off to the team with the details. Don't promise a date.

## Timeline passed

If more than 10 business days have passed since a card refund and it isn't on the statement, say the refund was sent on <date> and hand off so the team can send the refund details to show the bank.
