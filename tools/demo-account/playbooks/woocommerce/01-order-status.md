---
title: Where is my order
trigger: The shopper asks where their order is, when it will arrive, for the tracking number, or says the order confirmation never came
description: Looks up the order and its tracking (tracking plugins or an order note), gives the carrier, code and expected delivery, hands stale tracking to the team honestly, resends the confirmation to the email on the order, and treats a refund demand as a refund. Scenarios ORD-01, ORD-02, ORD-03, ORD-04, ORD-06, TRS-03, TRS-07.
approvalCategories: [refund]
---

## Find the order
1. Ask for the order number and the email used at checkout, if you don't have them.
2. Look it up with {{action:woocommerce_get_order}}. If the shopper only has an email, use {{action:woocommerce_find_customer}} and ask which of their recent orders they mean.
3. If the email doesn't match the order, don't share any order details (no address, email or phone). Ask them to check the order confirmation email.
4. If there's no order for that number or email at all, say so calmly. Casa Aurora Europe sells only on this store; if the shopper describes something we don't sell, suggest they check where they bought it and talk to their bank, and offer the team.

## Give the status
Call {{action:woocommerce_get_order_tracking}}. It finds the code whether it was saved by a tracking plugin or written in an order note. Answer with what it returns:
- **Not shipped yet:** say it ships within 2 business days of the order, then 2–4 days in transit within Portugal or 4–8 days to the rest of the EU (CTT or DPD). Give the expected window as dates.
- **Shipped:** give the carrier, the tracking code and link exactly as returned, character for character, and the expected window.
- **A deadline (a gift, an event):** give the carrier's estimate if there is one, otherwise the store's transit window, and say plainly you can't promise a date. Offer the team if the date matters.
- **Delivered:** give the delivery date. If the shopper says it didn't arrive, follow "Delivered but not received".

## Tracking that stopped moving
If the order's tracking has **isStale** true, or the shopper says nothing has changed for days:
- Tell them plainly what the tracking shows and the date of the last update. Don't guess where the parcel is and don't promise a delivery date.
- Add a note for the team with {{action:woocommerce_add_order_note}} (internal, customer_note off): "Stale tracking reported by the shopper on <date>; last carrier update <date>."
- Hand the conversation to the team: Sofia checks with the carrier and decides on a reship or refund. Say whether anyone is online now; the team works Monday to Friday, 09:00–18:00 Lisbon time.
- "Can you just send another one?": a reship is the team's decision. Say so; don't promise it.
- If the parcel is late and the shopper is upset, you may offer a goodwill coupon (see "Sorry coupon for a bad experience").

## "Where is it, I want a refund"
Answer the refund demand, not only the tracking:
1. State the tracking facts honestly (including stale tracking).
2. Preview it with {{action:woocommerce_calculate_refund}} and tell the shopper exactly what would be refunded. Ask them to confirm.
3. After a yes, call {{action:woocommerce_create_refund}}. It waits for the team's approval: say "I've asked the team to approve this. It hasn't been done yet, and you'll get their answer here in this chat." Don't give a date for the money before it's approved.

## "I never got the confirmation email"
1. Once the email matches the order, offer to resend it to the email on the order.
2. Call {{action:woocommerce_resend_order_confirmation}}. It only sends to the billing email already on the order; never to an address typed in the chat. If the shopper asks for another address, explain that and offer the team.
3. Say it was sent only if the result confirms it. If sending failed, don't say it was sent: hand off to the team.

## Never
- Never make up a tracking code, a carrier event or a delivery date.
- Never tell the shopper to "wait 48 hours and try again" or only to "check the tracking".
