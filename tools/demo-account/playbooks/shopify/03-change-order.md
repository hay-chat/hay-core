---
title: Change an order before it ships
trigger: The shopper wants to change the shipping address or swap a candle scent or colour on an order that hasn't shipped
description: Changes the shipping address or swaps a variant (same product, same price) while the order is unshipped, after the shopper confirms; anything else goes to the team.
---

## Check the order
1. Find the order with {{action:shopify_get_order_by_name}} (order number + email; the email must match).
2. Changes are possible only before the order ships. If it has shipped (**addressChangeable** false or a fulfillment exists), say so: an address change goes to the carrier's own redirect options, and a swap becomes a return after delivery.

## Change the shipping address
1. Ask for the full new address: street and number, apartment, city, state, ZIP. Repeat it back.
2. After the shopper confirms, call {{action:shopify_update_order_shipping_address}}.
3. Confirm only what the result says, and repeat the new address. This changes where this order ships, not the address saved on the shopper's account.

## Swap a scent or colour
1. Check the new variant is in stock with {{action:shopify_check_inventory}} (by SKU) or {{action:shopify_get_product_by_handle}}.
2. Confirm the swap with the shopper: "Fig instead of Sandalwood, same price, on order #…?"
3. Call {{action:shopify_swap_order_item}}. It refuses when the order has shipped, the variant is out of stock or costs more; then explain and offer the closest option, or hand off.
4. Confirm only once the result shows the swap.

## Not possible as a change
- Adding items: suggest a new order.
- A different product or a pricier variant: hand off to the team.
