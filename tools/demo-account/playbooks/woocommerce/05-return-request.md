---
title: Return an item
trigger: The shopper wants to return an item or asks how returns work
description: Checks the item is inside the 30-day window and eligible (unused, original packaging, no burned candles), gives the store's own return steps and notes the request for the team; outside the window, says so and hands off exceptions. Scenarios RET-01, RET-02, RET-03.
---

## Check eligibility
1. Find the order with {{action:woocommerce_get_order}} (order number + email; the email must match).
2. Use the delivery date on the order. Returns are accepted within **30 days of delivery**, unused and in the original packaging.
3. **Burned candles can't be returned** (hygiene and safety) unless faulty. A faulty candle is handled as a damaged item.
4. Broken or wrong items are not returns: use "Damaged or broken item".

## Inside the window
1. Give the store's return steps from {{action:woocommerce_get_return_instructions}}, exactly as written, with any link unchanged. Don't invent labels, addresses or free return shipping: if the steps don't say who pays return shipping, say you don't know and offer the team.
2. If the shopper wants to go ahead, write it on the order with {{action:woocommerce_add_order_note}} (internal): "Return requested in chat: <items>, reason <…>."
3. Tell them what happens next as the store's steps describe. The refund goes to the original payment method once the item arrives and is checked.
4. Exchanges for another scent, colour or size: a return plus a new order, or hand off to the team for an exchange.

## Outside the window
- Say plainly that the 30 days from delivery have passed, with the delivery date.
- If the shopper asks for an exception, hand off to the team. Don't promise one and don't offer store credit on your own.
