---
title: "Hay.chat dashboard: human handoff, approvals, team, usage and billing"
type: tutorial
verified: 2026-11-09
sources:
  - hay-core dashboard/composables/useSettingsNav.ts, i18n/locales/en (assistant.json escalation, actions.json aiActions, settings.json users/businessHours)
  - hay-website src/refund-policy.md, src/pricing/en.locale.js (billing page, Usage)
  - hay-core CHANGELOG.md 0.1.0 (business hours, handoff)
  - hay-docs user-guide settings.md (claude/ui-audit): two-factor, Active Sessions
todo:
  - TODO(Roger) Where exactly an owner changes payment method or sees invoices is only documented as the billing page at hay.chat/billing and the Stripe customer portal ("Manage or cancel plan"). The assistant sends people there and offers the team.
---
# Handoff, approvals, team, usage and billing

## Human handoff
1. **When the AI hands over:** the shopper asks for a person, a tool fails, confidence is low, a check fails, a playbook step says so, or an approval expires.
2. **What the assistant says:** Settings > Assistant, scroll to **Human escalation**. Under "If any human agent is available" and "If all human agents are unavailable" write instructions (for example "ask for their email"). You can instead choose **Create a ticket** (needs a connected helpdesk such as Zendesk) so a ticket with a summary and the full conversation is raised.
3. **When your team is available:** Settings > Channels > Business Hours > Add schedule. Pick a timezone, channels (leave all unticked for the default) and hours, plus closures. Outside these hours the AI keeps answering and conversations that need a person wait in the queue.
4. **Who answers:** the sidebar **Inbox** lists conversations waiting for a person. Open one to read the whole history and take over.

## Approvals for risky actions
Settings > Assistant > **Actions**. Choose which actions must wait for a person (refunds, cancellations, discounts and coupons, exchanges, returns, address changes and others). Optionally set an amount under which refunds and discounts run without approval, ask the customer to confirm first, and choose which roles can approve. A person approves or declines from the conversation or the Inbox. The Compliance > Action log lists what ran.

## Team and roles
Settings > Workspace > **Users** (Team Members) > **Invite Member**: enter the email and a role (owner, admin, member, viewer and others are offered). The owner can always approve actions. **Two-factor authentication:** each person sets it up under Settings > My Profile > Two-factor authentication: click **Set up two-factor**, confirm your password, add the setup key to an authenticator app and enter the code. Save the recovery codes (each works once and they are not shown again). Later you can get **New recovery codes** or **Turn off**. An owner can switch on **Require two-factor authentication** for the team on the Users page (Two-factor authentication for your team); members who have not set it up are asked at their next sign-in. **Active Sessions** in My Profile lists signed-in devices (a session ends 30 days after sign-in): **Sign out** one device or **Sign out all other devices**.

API access: Settings > Developers > API Tokens > Create Token (shown once).

## Usage and billing
- **See your resolutions:** Settings > Billing & Usage > Usage lists every billable resolution with its transcript, exportable as CSV, and lets you exclude one with a reason.
- **Plan, upgrade, cancel:** the billing page at hay.chat/billing (sign in with your account). Upgrades are immediate and prorated; a lower plan starts at the next billing date. Cancel plan keeps access to the end of the paid period. The payment method and invoices are handled in the Stripe customer portal reached from "Manage or cancel plan".
- **Refunds:** monthly plans are non-refundable, including the first month. Annual plans are non-refundable unless you end them early (10% fee on the remaining value, balance refunded within 10 business days); see hay.chat/refund-policy/. Never promise a refund; for an exception or a billing problem, hand the question to the team.
- **Deleting data:** after a plan ends data is kept for 90 days and can be downloaded in Settings > Privacy.

Sources: Hay.chat dashboard; hay.chat/refund-policy; hay.chat/pricing.
