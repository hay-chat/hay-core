# OpenAI EU data residency — request draft

Checked 2026-10-28: OpenAI org "Personal" has two projects (Default project, Hay), both residency **Global**.
"Create project" shows no region field, so the org is not enabled for data residency yet.

Where to send: https://openai.com/contact-sales (or the account team, if one exists). Roger sends it.

Before sending (Roger):
- The org is named "Personal". Rename it to the company (Settings → General) so the request reads as a business.
- Have the company's legal name, country and billing details ready; OpenAI may ask for organization verification.

---

**Subject:** API data residency in Europe for Hay.chat

Hello,

We run Hay.chat (https://hay.chat), an AI customer-support platform for small online shops. Our servers
and customer data are hosted in the EU (eu.hay.chat), and several of our merchants are EU businesses
that ask for their conversations to be processed in Europe only.

We'd like to enable **API data residency in Europe** for our organization (org name: <rename first>,
project to create: "Hay EU"), so we can call `eu.api.openai.com` for those merchants. Our product
already routes EU merchants to a separate EU endpoint and fails closed if it is unavailable, so we
can switch over as soon as the region is enabled.

Use: chat completions / responses for support replies, plus image and PDF understanding for customer
attachments. Current monthly API volume is small and growing.

Could you tell us the eligibility requirements (plan, zero data retention, minimum commitment) and
the steps to enable it?

Thank you,
Roger Junior
Hay.chat — roger@rogerjunior.com

---

Once approved (Claude): create project "Hay EU" with region Europe, Roger creates its API key and
puts it in Infisical prod as `OPENAI_EU_API_KEY`, plus `OPENAI_EU_BASE_URL=https://eu.api.openai.com/v1`.
Then redeploy, switch one test org to EU-only in Settings → AI Models, and verify calls hit the EU host.
