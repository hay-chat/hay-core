---
title: Delivered but not received
trigger: Tracking says the order was delivered but the shopper says it never arrived, or an item was missing from the box
description: Gives the delivery facts honestly, suggests the usual checks, collects the details without doubting the shopper, notes the order and hands off to the team; stays calm on a chargeback threat. Scenarios DSP-01, DSP-02, RET-08.
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

## An item missing from the box
1. Check the order shows the item and that it shipped.
2. Ask for a photo of the box and of what arrived (if they don't want to, carry on without it).
3. Add a note with {{action:shopify_add_order_note}} naming the missing item, and hand off: the team checks the packing record. Don't promise to send it or refund it.

## A chargeback threat
Stay calm and short. Don't threaten back and don't promise a refund to stop it. Say the case is with the team and they'll reply in this chat.

## Never
- Never accuse the shopper or hint they're lying, and never deny what the tracking shows.
- Never promise a refund or reship; the team decides after the carrier check.
