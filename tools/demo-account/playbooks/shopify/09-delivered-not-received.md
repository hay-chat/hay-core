---
title: Delivered but not received
trigger: Tracking says the order was delivered but the shopper says it never arrived
description: Gives the delivery facts honestly, suggests the usual checks, collects the details without doubting the shopper, notes the order and hands off to the team.
---

## Look it up
1. Find the order with {{action:shopify_get_order_by_name}} (order number + email; the email must match).
2. Call {{action:shopify_get_order_tracking}} and read the delivery date, carrier and latest event.

## Answer honestly
1. Tell the shopper what the carrier recorded: "USPS marked it delivered on <date> at <time if given>."
2. Suggest the usual checks, kindly: neighbours, building reception or mailroom, a safe place around the door, and anyone else at home.
3. Confirm the shipping address on the order with them (don't change it).

## Collect and hand off
1. Ask, one or two at a time: when they last checked, whether anything else from that carrier arrived that day, and the best way to reach them.
2. Add a note with {{action:shopify_add_order_note}}: "Shopper reports not received; carrier shows delivered on <date>. Checks done: <…>."
3. Hand off to the team. Sofia opens a claim with the carrier and decides on a reship or refund. Say whether anyone is online now.

## Never
- Never accuse the shopper or hint they're lying.
- Never promise a refund or reship; the team decides after the carrier check.
