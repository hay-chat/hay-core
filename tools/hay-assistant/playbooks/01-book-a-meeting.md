---
title: Book a meeting with the Hay.chat team
trigger: The visitor wants a demo, a call, a meeting, to talk to someone, to "see it live", or to speak to the founders or sales
description: Collects the visitor's name, email and time zone, offers real open slots from the Cal.com calendar, books the meeting after they pick one and confirms it. Also reschedules or cancels. Never invents a time; if the calendar is unavailable it gives the booking link.
approvalCategories: []
---

## Before you start

- Meetings are 30-minute video calls with the Hay.chat founders. Only offer times the calendar returns.
- Do not ask for the company's life story first. A call is the goal; the email is what you need.

## Collect the details

1. Ask for their **email** first. Without an email you cannot book. If they refuse, give the self-booking link https://cal.com/roger-hay/quick-chat and stop.
2. Ask for their **first and last name**.
3. Ask for their **time zone** or the city they are in (for example "Lisbon" or "New York"). Convert it to an IANA name such as Europe/Lisbon or America/New_York. If unsure, ask once more; do not guess.
4. Optionally ask, in one short question, what they would like to cover. Do not make it a condition.

## Find real times

1. Call {{action:list_event_types}} and pick the event type titled "Quick chat" (30 minutes). If you cannot find it, apologise, give the link https://cal.com/roger-hay/quick-chat and offer to hand the conversation to the team.
2. Call {{action:get_available_slots}} with that event type id, a start of tomorrow and an end about 7 days later, and the visitor's time zone. The calendar needs about 2 hours notice; use only slots it returns.
3. Offer **three** slots that are well spread out (different days or parts of the day), written in the visitor's time zone with the time zone name. Ask which one suits them.
4. If none suit them, search the following week once. If still nothing, give the link and offer the team.

## Book it

1. Only after they choose a slot and have confirmed the email address, call {{action:create_booking}} with:
   - the event type id and the exact slot start, converted to UTC (ending in Z);
   - their name, email and time zone;
   - guest damien@hay.chat so both founders attend.
   Put nothing else in the booking: no notes about the conversation, no opinions, no internal comments.
2. If the booking succeeds, confirm in one short message: the day, time and time zone, that the invite is on its way to their email, and that it is a 30-minute video call. Do not say "booked" before the tool result says so.
3. If it fails (slot just taken, error), say so plainly, call {{action:get_available_slots}} again and offer the next slots. After two failures give the link https://cal.com/roger-hay/quick-chat and offer the team.
4. If the booking is waiting for the team's approval, say it has been requested and is not confirmed yet.

## Change or cancel a meeting

1. Ask for the email they booked with. Find the meeting with {{action:list_bookings}} filtered by that email and upcoming status. Only act on a meeting under that email.
2. To move it: offer new times with {{action:get_available_slots}}, then use {{action:reschedule_booking}}.
3. To cancel: confirm first, then use {{action:cancel_booking}}. Cancellations wait for the team's approval; tell the visitor that.

## Never

- Never invent or assume a free time, and never promise a time before the tool has returned it.
- Never share other people's meetings or emails.
- Never use the booking to store internal notes about the visitor.
