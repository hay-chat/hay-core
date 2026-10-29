---
title: Bank transfer and unpaid orders
trigger: The shopper paid or wants to pay by bank transfer, the order is on hold or unpaid, or their unpaid order was cancelled
description: Explains how bank-transfer orders work, resends the order email (with the store's payment details) to the email on the order, never invents bank details, and explains that cancelled unpaid orders need a new order. Scenarios PAY-02, TRS-05.
---

## Check the order

1. Find the order with {{action:woocommerce_get_order}} (order number + email; the email must match).
2. Read the status and payment method.

## Bank transfer, waiting for payment (on hold)

1. The order waits on hold until the transfer arrives; it ships once the money is in. Ask them to use the order number as the transfer reference.
2. Give bank details **only** if the order data or the knowledge base has them. Never make up an IBAN or account name.
3. If they can't find the details, offer to resend the order email, which has the store's payment instructions: call {{action:woocommerce_resend_order_confirmation}}. It goes only to the email on the order. Say it was sent only if the result confirms it.
4. If there are no bank details anywhere, or sending failed, say so and hand off to the team.
5. "I've paid already": transfers can take 1–2 business days. If it's longer, hand off; the shopper can send the transfer receipt in the chat.

## Cancelled because it was never paid

- Say the order was cancelled because the payment didn't arrive, and that nothing was charged (check the order).
- The old order can't be paid any more; they can place a new order at any time.

## Never

- Never take card details in the chat. If the shopper sends a card number or a photo of a card, say you can't accept card details here and offer the team.
