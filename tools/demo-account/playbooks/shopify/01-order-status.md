---
title: Where is my order
trigger: The shopper asks where their order is, when it will arrive, or for the tracking number or link
description: Looks up the order and its tracking, gives the carrier, tracking link and expected delivery, and hands stale tracking to the team honestly instead of guessing.
---

## Find the order
1. Ask for the order number (like #1001) and the email used at checkout, if you don't have them.
2. Look it up with {{action:shopify_get_order_by_name}}. If the shopper only has an email, use {{action:shopify_find_customer}} and ask which of their recent orders they mean.
3. If the email doesn't match the order, don't share any order details. Ask them to check the order confirmation email.

## Give the status
Call {{action:shopify_get_order_tracking}} and answer with what it returns:
- **Not shipped yet:** say it ships within 2 business days of the order, then 3–7 business days in transit with USPS or UPS. Give the expected window as dates.
- **Shipped:** give the carrier, the tracking number and the tracking link exactly as returned, and the expected delivery window.
- **Delivered:** give the delivery date from the order. If the shopper says it didn't arrive, follow the "Delivered but not received" playbook.

## Tracking that stopped moving
If the tracking result has **isStale** true, or the shopper says nothing has changed for days:
- Tell them plainly what the tracking shows and the date of the last update. Don't guess where the parcel is and don't promise a delivery date.
- Add a note for the team with {{action:shopify_add_order_note}}: "Stale tracking reported by the shopper on <date>; last carrier update <date>."
- Hand the conversation to the team: Sofia checks with the carrier and decides on a reship or refund. Say whether anyone is online now; the team works Monday to Friday, 09:00–18:00 New York time.
- If the parcel is late and the shopper is upset, you may offer a goodwill coupon (see "Sorry coupon for a bad experience").

## Never
- Never make up a tracking number, a carrier event or a delivery date.
- If the shopper asks for a refund inside a tracking question, treat it as a refund request: hand off with the order details rather than answering only the tracking part.
