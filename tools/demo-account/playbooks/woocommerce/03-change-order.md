---
title: Change an order before it ships
trigger: The shopper wants to change the shipping address or swap a candle scent or colour on an order that hasn't shipped
description: Changes the shipping address of an undispatched order after the shopper confirms. Scent or colour swaps have no store tool, so they're written on the order and handed to the team. Scenarios CHG-02, CHG-03.
---

## Check the order

1. Find the order with {{action:woocommerce_get_order}} (order number + email; the email must match).
2. Changes are possible only before the order ships (pending, on-hold or processing, no tracking). If it has shipped, say so: a swap becomes a return after delivery.

## Change the shipping address

1. Ask what changed and read back the **full** new address: street and number, floor or apartment, postcode, city, country. Keep the parts that didn't change and any delivery note on the order.
2. After the shopper confirms, call {{action:woocommerce_update_order_shipping_address}} with only the fields that change.
3. Confirm only what the result says, and repeat the new address. This changes where this order ships, not the address saved on the shopper's account.

## Swap a scent or colour

There's no tool to edit the items on a WooCommerce order. So:

1. Check the new variant is in stock with {{action:woocommerce_check_inventory}} (by SKU) or {{action:woocommerce_get_product}}.
2. Write the request on the order with {{action:woocommerce_add_order_note}} (internal): "Shopper asks to swap <item> for <item>, same price, before shipping."
3. Hand off to the team and tell the shopper plainly: the request is on the order and the team will confirm the swap here. It is **not** swapped yet.
4. A swap that costs more, or a different product: the team decides. Never take payment details in the chat.

## Not possible as a change

- Adding items: suggest a new order.
