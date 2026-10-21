# Meta developer dashboard — state of the Hay.chat app (read-only inspection 2026-10-21)

Items marked "not verified" were not opened (action budget) — re-check before relying on them.

## Apps

| App                            | ID                                 | Mode                       | Business                              |
| ------------------------------ | ---------------------------------- | -------------------------- | ------------------------------------- |
| **Hay.chat**                   | **1869497150332050**               | Live                       | Hay.chat portfolio `1352071519906201` |
| Conversions API Application ×2 | 1399379727980662, 1211121517414965 | unrelated (The Queer Spot) |                                       |

Env: local `.env` has no META\_\* vars (prod only). Instagram plugin uses `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`.

## Use cases / products (Hay.chat)

- **Connect with customers on WhatsApp** — present
- Engage customers on Messenger — present
- Manage messages and content on Instagram — present
- **Facebook Login for Business** — configured product in sidebar

## Settings → Basic

- Mode Live/Published. Namespace `haychat`. Contact hello@hay.chat. App domain `hay.chat`. Site URL `https://eu.hay.chat/`.
- Privacy policy https://hay.chat/privacy-policy ✓; Terms https://hay.chat/terms-of-service ✓; Data deletion = instructions URL → privacy policy ✓.
- Category: Messenger bots for businesses. Icon ✓. Data Use Checkup complete ✓. DPO contact + Lisbon address set.
- "Provide test instructions" — not verified whether filled.

## Permissions (WhatsApp use case)

All **Standard access only** ("Ready for testing"), no review submitted, nothing pending/rejected:
`business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`, `whatsapp_business_manage_events`, `manage_app_solution`, `public_profile`. `email` not requested. Instagram/pages permission levels: not verified.

## WhatsApp → API Setup

- **Test number** +1 541 283 0451, `phone_number_id 976350592236691`. No real business number.
- Alerts: "pending review" alerts in WhatsApp Manager (content unknown); **"Payment method missing or invalid for 1 of your accounts"** → at least one WABA exists under the portfolio.
- Sub-tabs present: Permissions, Quickstart, API Setup, Configuration, **Tech Provider Integration**, **Embedded Signup Configurator**, Partner Solutions, Migrate customers. ES configurator contents: not verified. Webhook callback URL set?: not verified.

## Business portfolio

- **Business verification: VERIFIED** (DIVINEVOLUTION, UNIPESSOAL, LDA — Oct 13, 2025).
- 0 of 1 people have 2FA; single admin (Meta recommends a second).
- WhatsApp accounts list: not verified.

## Blockers / to-do for launch

1. App Review for Advanced Access on `whatsapp_business_management` + `whatsapp_business_messaging` (Business Verification already done → unblocked). `business_management` not needed for pure Tech Provider flow.
2. Payment method missing on a WABA (only matters for Hay's own test/demo WABA; customers pay their own).
3. Pending review alerts in WhatsApp Manager — read them.
4. Create an **Embedded Signup v4 configuration** under Facebook Login for Business (new config required for v4) → `config_id`.
5. Subscribe webhook fields + set the production callback URL in the app dashboard.
6. Enable 2FA on the admin account; add a second admin.
7. Check "Tech Provider Integration" tab status.
