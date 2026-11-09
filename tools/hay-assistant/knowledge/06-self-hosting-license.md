---
title: "Hay.chat: self-hosting and the licence"
type: guide
verified: 2026-11-09
sources:
  - hay-core SELF_HOSTING.md
  - hay-core LICENSE (Hay Community License v1.0)
  - hay-core README.md
  - hay-website src/llms.njk and src/self-hosted/index.njk
todo:
  - TODO(Roger) hay.chat/self-hosted/ says Node.js 18+ for development while README says 22.12+. This document gives only the Docker route (SELF_HOSTING.md). Fix the website page.
  - TODO(Roger) Whether Hay offers paid support or installation help for self-hosters is not documented. The assistant offers a call.
---
# Self-hosting and licence

## Is it open source?
It is **source-available**, not OSI-approved open source. Code: github.com/hay-chat/hay-core under the **Hay Community License v1.0**. You may use it for your own business and your own customers, view and study the code, modify it and distribute copies under the same licence. You may NOT sell it or offer it as a hosted or managed service that competes with Hay's own, you may not use the Hay brand to suggest endorsement (a modified version needs a different name), and you must keep the "Powered by Hay" notice in the chat widget. Say "source-available", never "open source" without that qualifier. For legal questions about the licence, offer a call.

## What you need
Per SELF_HOSTING.md: a Linux server with Docker Engine 24+ and the Compose plugin, 2 vCPUs and 4 GB RAM minimum (8 GB comfortable; the image build needs about 4 GB), about 15 GB of disk, a domain whose DNS points at the server with ports 80 and 443 open, and an OpenAI API key (knowledge-base embeddings always use OpenAI text-embedding-3-small). Optional: SMTP for signup, reset and invite emails.

The stack: API, dashboard, chat widget, PostgreSQL 16 with pgvector, Redis, RabbitMQ and a Caddy proxy that gets HTTPS certificates automatically.

## Install, in short
1. `git clone https://github.com/hay-chat/hay-core.git`, then `cd hay-core/selfhost` and `cp .env.example .env`.
2. Fill the REQUIRED block of `.env`: HAY_DOMAIN, DB_PASSWORD, DB_APP_PASSWORD, REDIS_PASSWORD, RABBITMQ_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, PLUGIN_ENCRYPTION_KEY, OPENAI_API_KEY.
3. `docker compose up -d --build` (first build takes 10 to 20 minutes).
4. Open `https://<HAY_DOMAIN>` and sign up. The first signup creates your organization and makes you owner.
5. Then set `ALLOW_SIGNUP=false` in `.env` and run `docker compose up -d` again, so nobody else can create an organization.

Full guide: SELF_HOSTING.md in the repository.

## Good to know
- **AI providers:** chat can use OpenAI, Anthropic, Gemini or any OpenAI-compatible endpoint, chosen per organization in Settings > AI Models (or a default in `.env`). Embeddings stay on OpenAI. A local server such as Ollama is untested.
- **Integrations:** on hay.chat some connect in one click through Hay's own OAuth apps. Those apps are not available to self-hosted installs: connect with an API key or token where the plugin offers it, or create your own app with the provider.
- **Meta channels** (WhatsApp, Instagram, Messenger) need your server to be publicly reachable for webhooks.
- **Telemetry:** none unless you set POSTHOG_KEY.
- **Upgrading:** `git pull`, then `docker compose up -d --build` in `selfhost/`; migrations run automatically.
- Self-hosting is free of Hay.chat plan fees. Billing, resolutions and the plans in the pricing document apply to the hosted service at hay.chat.

Sources: SELF_HOSTING.md, LICENSE, README.md in github.com/hay-chat/hay-core; hay.chat/self-hosted.
