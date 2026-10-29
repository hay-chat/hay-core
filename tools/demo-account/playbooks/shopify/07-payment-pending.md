---
title: Payment pending or unpaid order
trigger: The shopper's order shows payment pending, the payment failed, they want to pay again, or their unpaid order was cancelled
description: Checks the payment status, emails the payment link for an unpaid order to the email on the order after the email matches, and explains that cancelled unpaid orders need a new order. Scenarios PAY-02, TRS-05.
---

## Check the order
1. Find the order with {{action:shopify_get_order_by_name}} (order number + email).
2. Read the financial status and whether the order is cancelled.

## Unpaid, still open
1. Offer to email the payment link: "I can send the payment link to the email on your order. Shall I?"
2. After a yes, call {{action:shopify_send_payment_link}} with the email the shopper gave. It only sends to the email already on the order.
3. Say it was sent only if the result confirms it. If the email doesn't match, say you can't send it and ask them to check the address they used.

## Cancelled because it was never paid
- Say the order was cancelled because the payment didn't go through, and that nothing was charged (check the order: no paid transaction). The old payment link won't work; don't send one for a cancelled order.
- They can place a new order any time; nothing carries over from the old one.

## Never
- Never take card details in the chat. If the shopper sends a card number or a photo of a card, say you can't accept card details here.
