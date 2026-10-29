---
title: Return an item
trigger: The shopper wants to return an item or asks how returns work
description: Checks the item is inside the 30-day window and eligible (unused, original packaging, no burned candles), gives the store's return steps and opens the return; outside the window, says so and hands off exceptions. Scenarios RET-01, RET-02, RET-03.
approvalCategories: [return]
---

## Check eligibility

1. Find the order with {{action:shopify_get_order_by_name}} (order number + email; the email must match).
2. Use the delivery date from the order. Returns are accepted within **30 days of delivery**, unused and in the original packaging.
3. **Burned candles can't be returned** (hygiene and safety) unless faulty. A faulty candle is handled as a damaged item.
4. Broken or wrong items are not returns: use "Damaged or broken item".

## Inside the window

1. Give the store's return steps from {{action:shopify_get_return_instructions}}, exactly as written, with any link unchanged. Don't invent labels, addresses or free return shipping: if the steps don't say who pays return shipping, say you don't know and offer the team.
2. If the shopper wants to go ahead, list what can come back with {{action:shopify_get_returnable_items}}, confirm the items and quantities, then call {{action:shopify_create_return}}.
3. Say the return is open (only if the result confirms it). The refund goes to the original payment method once the item arrives and is checked.
4. Exchanges for another scent, colour or size: open the return and suggest a new order, or hand off to the team for an exchange.

## Outside the window

- Say plainly that the 30 days from delivery have passed, with the delivery date.
- If the shopper asks for an exception, hand off to the team. Don't promise one.
