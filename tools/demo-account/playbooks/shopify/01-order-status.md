---
title: Where is my order
trigger: The shopper asks where their order is, when it will arrive, for the tracking number, or says the order confirmation never came
description: Looks up the order and its tracking, gives the carrier, tracking link and expected delivery, and hands stale tracking to the team honestly instead of guessing. A refund demand inside a tracking question is handled as a refund. Scenarios ORD-01, ORD-02, ORD-03, ORD-04, ORD-06, TRS-03, TRS-07.
approvalCategories: [refund]
---

## Find the order
1. Ask for the order number (like #1001) and the email used at checkout, if you don't have them.
2. Look it up with {{action:shopify_get_order_by_name}}. If the shopper only has an email, use {{action:shopify_find_customer}} and ask which of their recent orders they mean.
3. If the email doesn't match the order, don't share any order details (no address, email or phone). Ask them to check the order confirmation email.
4. If there's no order for that number or email at all, say so calmly. Casa Aurora sells only on this store; if the shopper describes something we don't sell, suggest they check where they bought it and talk to their bank, and offer the team.

## Give the status
Call {{action:shopify_get_order_tracking}} and answer with what it returns:
- **Not shipped yet:** say it ships within 2 business days of the order, then 3–7 business days in transit with USPS or UPS. Give the expected window as dates.
- **Shipped:** give the carrier, the tracking number and the tracking link exactly as returned, character for character, and the expected delivery window.
- **A deadline (a gift, an event):** give the carrier's estimate if the tracking has one, otherwise the store's transit window, and say plainly you can't promise a date. Offer the team if the date matters.
- **Delivered:** give the delivery date from the order. If the shopper says it didn't arrive, follow the "Delivered but not received" playbook.

## Tracking that stopped moving
If the tracking result has **isStale** true, or the shopper says nothing has changed for days:
- Tell them plainly what the tracking shows and the date of the last update. Don't guess where the parcel is and don't promise a delivery date.
- Add a note for the team with {{action:shopify_add_order_note}}: "Stale tracking reported by the shopper on <date>; last carrier update <date>."
- Hand the conversation to the team: Sofia checks with the carrier and decides on a reship or refund. Say whether anyone is online now; the team works Monday to Friday, 09:00–18:00 New York time.
- "Can you just send another one?": a reship is the team's decision. Say so; don't promise it.
- If the parcel is late and the shopper is upset, you may offer a goodwill coupon (see "Sorry coupon for a bad experience").

## Never
- Never make up a tracking number, a carrier event or a delivery date.
- Never tell the shopper to "wait 48 hours and try again" or only to "check the tracking".

## "Where is it, I want a refund"
If the shopper asks for their money back inside a tracking question, answer the refund demand, not only the tracking:
1. State the tracking facts honestly (including stale tracking).
2. Call {{action:shopify_calculate_refund}} for the order and tell the shopper exactly what would be refunded. Ask them to confirm.
3. After a yes, call {{action:shopify_create_refund}} with the suggested transactions. It waits for the team's approval: say "I've asked the team to approve this. It hasn't been done yet, and you'll get their answer here in this chat." Don't give a date for the money before it's approved.

## "I never got the confirmation email"
Shopify can't resend the order confirmation from the chat. Say so plainly, give the order details you can see (items, total, status) once the email matches, and offer the team.
