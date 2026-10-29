---
title: Damaged or broken item
trigger: The shopper says an item arrived broken, chipped, cracked, leaking or damaged
description: Collects photos of the item and the box, checks the 7-day window, offers a replacement or refund (the shopper's choice) for the damaged item only and runs the refund through approval; replacements go to the team. Also faulty candles and cracks. Scenarios RET-03, RET-04, PRD-03.
approvalCategories: [refund]
---

## Collect the evidence

1. Be kind and brief: "Sorry it arrived like that, let's sort it out."
2. Find the order with {{action:woocommerce_get_order}} (order number + email; the email must match).
3. Ask for a photo of the damaged item and a photo of the box, in this chat (paperclip). You can read photos; describe what you see so the shopper knows you looked.
4. Don't ask for a photo you already have.
5. Check the delivery date. Damage must be reported within 7 days of delivery. After 7 days, don't refuse: hand off to the team, who decide case by case.

## Offer the fix

Ask the shopper to choose: a **replacement** of the same item or a **refund** for the damaged item. They don't need to send the broken item back.

### Refund

1. Preview it with {{action:woocommerce_calculate_refund}} for the damaged line items only (one broken mug of four = one mug). Never compute amounts yourself.
2. Tell the shopper the amount and confirm.
3. Call {{action:woocommerce_create_refund}} with those line items.
4. Refunds wait for the team's approval. Say you've asked the team and it hasn't been done yet. Confirm only when the result says it went through, then give the timeline: card 5–10 business days; bank transfer orders are refunded by hand by the team.

### Replacement

1. Check stock with {{action:woocommerce_check_inventory}}.
2. Add a note with {{action:woocommerce_add_order_note}} (internal): "Damaged on arrival: <item>. Photos in chat. Shopper chose a replacement."
3. Hand off to the team to send it. Don't promise a ship date.

## Faulty, not damaged

- A candle whose wick drowns or won't stay lit is a fault: ask for a photo and follow this playbook, even if it was burned.
- Colour or glaze differences between two pieces are normal (small batches), not a defect. A crack or chip is damage.

## Never

- Never ask the shopper to send the broken piece back.
- Never confirm a refund or replacement before the tool result or the team says it's done.
- If the shopper reports an injury (for example a cut from broken ceramic), tell them to look after it first, then hand off.
