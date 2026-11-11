![Hay.chat: self-hosted AI customer support](git-hero.jpg)

Hay.chat is self-hosted AI customer support software. Its AI agents resolve customer requests instead of just answering them: they look up orders, issue refunds and update orders through Shopify, WooCommerce and Stripe, and hand off to a human when they aren't confident. Run it on your own server with Docker, or use the hosted version at [hay.chat](https://hay.chat).

Best for Shopify and WooCommerce stores that want AI to actually issue refunds and update orders, on a flat monthly plan with no per-seat fees, with a human approval step available on any action.

[Website](https://hay.chat) · [Documentation](https://hay.chat/docs/technical/)

![GitHub commit activity](https://img.shields.io/github/commit-activity/m/hay-chat/hay-core)
![GitHub last commit](https://img.shields.io/github/last-commit/hay-chat/hay-core)
![GitHub issues](https://img.shields.io/github/issues/hay-chat/hay-core)
![GitHub pull requests](https://img.shields.io/github/issues-pr/hay-chat/hay-core)
![GitHub repo size](https://img.shields.io/github/repo-size/hay-chat/hay-core)
![Node.js version](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## What is Hay.chat?

Hay.chat lets businesses deploy AI agents that handle customer support 24/7 across multiple channels. Agents are grounded in your documentation, follow structured playbooks, and seamlessly escalate to humans when needed.

**Key capabilities:**

- **AI Assistant** — One assistant per organization: configure its name, tone, instructions and hand-off behavior. Test before deploying.
- **Knowledge Base** — Upload PDFs, Word docs, text, markdown, or import from URLs. Agents use vector search to ground answers in your content.
- **Playbooks** — Step-by-step workflows for specific scenarios (refunds, order lookups, greetings, etc.).
- **Multi-channel** — Live chat widget, WhatsApp, Instagram DMs, Messenger and email, via plugins.
- **Human Handoff** — Automatic escalation with full conversation context, plus an approval step for refunds, cancellations and discounts.
- **Plugin Ecosystem** — Shopify, WooCommerce, Magento, Wix, Nuvemshop, Stripe, HubSpot, Zendesk and more via MCP (Model Context Protocol).
- **Analytics** — Resolution rate, response time, customer satisfaction, and conversation insights.
- **Privacy** — GDPR-compliant data handling with DSAR support.

## Self-host Hay.chat

Hay.chat runs on one server with Docker Compose: PostgreSQL 16 with pgvector, Redis 7, RabbitMQ and a Caddy proxy with automatic HTTPS. Follow **[SELF_HOSTING.md](SELF_HOSTING.md)** for install, email, integrations, upgrades and backups. [Getting Started](#getting-started) below is for local development.

Chat models: OpenAI, Anthropic, Gemini, or any OpenAI-compatible endpoint (for example DigitalOcean Gradient, or a local server such as Ollama, which is untested). Embeddings use OpenAI `text-embedding-3-small`, so an OpenAI key is still required. No telemetry is sent unless you set `POSTHOG_KEY`.

Teams comparing Chatwoot, Zammad or Dify for self-hosted AI support use Hay.chat when they need the agent to take actions, not just reply.

## Tech Stack

| Layer    | Technology                                          |
| -------- | --------------------------------------------------- |
| Frontend | Nuxt 3 (Vue 3), Tailwind CSS, shadcn-vue, Pinia     |
| Backend  | Express 5, tRPC v11, TypeORM                        |
| Database | PostgreSQL 16 + pgvector                            |
| Cache    | Redis 7                                             |
| AI       | OpenAI, Anthropic, Gemini or OpenAI-compatible      |
| Auth     | JWT, API Keys, OAuth 2.0                            |
| Plugins  | Model Context Protocol (MCP)                        |
| Webchat  | Vue 3 embeddable widget (Vite)                      |
| Testing  | Vitest (frontend), Jest (backend), Playwright (E2E) |

## Project Structure

```
├── dashboard/          # Nuxt 3 frontend
├── server/             # Express + tRPC backend
├── webchat/            # Embeddable chat widget
├── plugins/
│   ├── core/           # Built-in plugins (email, stripe, hubspot, etc.)
│   └── custom/         # User-created plugins
├── packages/
│   ├── plugin-sdk/     # @hay/plugin-sdk
│   └── server-sdk/     # @hay/server-sdk
├── docs/               # Technical and user documentation
├── tests/              # Playwright E2E tests
└── docker-compose.yml  # PostgreSQL + Redis
```

## Getting Started

### Prerequisites

- Node.js 22.12 or newer
- npm >= 9
- Docker, running (for PostgreSQL, Redis and RabbitMQ)
- An OpenAI API key (embeddings always use OpenAI, even with another chat provider)

### Setup

```bash
git clone https://github.com/hay-chat/hay-core.git
cd hay-core

# One-time setup (safe to re-run)
OPENAI_API_KEY=sk-... npm run setup

# Start development
npm run dev
```

`npm run setup` (`scripts/setup-dev.sh`):

1. Starts PostgreSQL with pgvector, Redis and RabbitMQ with `docker compose up -d` (the app itself runs on your machine, so you get hot reload).
2. Runs `npm install`.
3. Creates `.env` from `.env.example` with generated JWT secrets and `REQUIRE_EMAIL_VERIFICATION=false` (no SMTP locally). It keeps an existing `.env` and only fills in empty JWT secrets. If you don't pass `OPENAI_API_KEY`, set it in `.env` afterwards.
4. Builds the plugin SDK (plugins are built on demand against it) and the webchat widget (served by the API).
5. Runs database migrations.
6. Creates a dev login, `dev@hay.local` / `hay-dev-password`, that owns the "Hay Dev" organization (`npm run dev:account` in `server/`). It only runs with `NODE_ENV=development` against a local database.

Then open `http://localhost:3000` and log in with the dev login, or sign up for a new organization. The API runs on `http://localhost:3001` and the RabbitMQ admin UI on `http://localhost:15672` (`hay` / `hay_password`).

To chat with your local assistant from the terminal, use the `hay` CLI (see [tools/hay-cli/README.md](tools/hay-cli/README.md)):

```bash
HAY_EMAIL=dev@hay.local HAY_PASSWORD=hay-dev-password tools/hay-cli/bin/hay --target local orgs
tools/hay-cli/bin/hay --target local --org <org-id> chat send "Hi"
```

Optional: set `CHROME_EXECUTABLE_PATH` to a local Chrome or Chromium to import websites into the knowledge base, and the `SMTP_*` variables to send email.

The dev server (`npm run dev:server`) skips type-checking on restart for speed. Type errors show in your editor and in `npm run typecheck` (CI runs it too).

`selfhost/compose.yml` runs the whole app in Docker, but it is a production build without hot reload; use it to self-host (see [SELF_HOSTING.md](SELF_HOSTING.md)), not for development.

### Environment Variables

| Variable                                                                     | Required   | Description                       |
| ---------------------------------------------------------------------------- | ---------- | --------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`                | Yes        | PostgreSQL connection             |
| `REDIS_HOST`, `REDIS_PORT`                                                   | Yes        | Redis connection                  |
| `RABBITMQ_URL`                                                               | Yes        | Message queue (AI replies)        |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                                           | Yes        | Auth secrets (min 32 chars)       |
| `OPENAI_API_KEY`                                                             | Yes        | OpenAI API key for AI features    |
| `LLM_BASE_URL`, `LLM_VENDOR`, `LLM_API_KEY`, `LLM_TIER_*`                    | No         | Other OpenAI-compatible chat host |
| `SMTP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_AUTH_USER`, `SMTP_AUTH_PASS` | No         | Email sending                     |
| `BASE_DOMAIN`, `API_DOMAIN`, `DASHBOARD_DOMAIN`                              | Production | Domain configuration              |

## Development

```bash
# Run everything
npm run dev

# Individual services
npm run dev:server        # Backend only (port 3001)
npm run dev:dashboard     # Frontend only (port 3000)
npm run dev:webchat       # Webchat widget

# Testing
npm run test              # All tests
npm run test:server       # Server tests (Jest)
npm run test:dashboard    # Dashboard tests (Vitest)

# Code quality
npm run lint              # Lint all code
npm run lint:fix           # Auto-fix lint issues
npm run typecheck         # TypeScript checks

# Database
npm run migration:run     # Run pending migrations
npm run migration:generate -- ./database/migrations/Name  # Generate migration
npm run migration:revert  # Revert last migration
```

## Architecture

### AI Orchestrator

The orchestrator processes conversations through a three-layer pipeline:

1. **Perception** — Analyzes user intent, sentiment, and language
2. **Retrieval** — Finds relevant playbooks and documents via vector similarity search
3. **Execution** — Generates responses using agent context, retrieved knowledge, and active plugins

A two-stage guardrail system protects response quality:

- **Stage 1**: Company interest protection — blocks harmful responses
- **Stage 2**: Fact grounding — validates claims against source documents

### Plugin System

Plugins extend Hay.chat via the Model Context Protocol (MCP). Each plugin is loaded dynamically at runtime — the core never hardcodes plugin references.

**Core plugins:**

| Plugin                         | Category   | Description                                       |
| ------------------------------ | ---------- | ------------------------------------------------- |
| Shopify                        | E-commerce | Orders, tracking, refunds, returns, exchanges     |
| WooCommerce                    | E-commerce | Orders, tracking, cancellations, refunds, coupons |
| Magento, Wix, Nuvemshop        | E-commerce | Orders, tracking, cancellations, refunds          |
| Stripe, Mercado Pago           | Payments   | Customers, payments, subscriptions, disputes      |
| WhatsApp, Instagram, Messenger | Channel    | Meta channels (Cloud API, Instagram DMs)          |
| Email inbox                    | Channel    | AI replies in the same email thread               |
| Chatwoot                       | Channel    | Hay.chat as the bot inside a Chatwoot inbox       |
| HubSpot, Twenty, Klaviyo       | CRM        | Contacts, companies, deals, marketing             |
| Zendesk                        | Help desk  | Tickets, customers, workflows                     |
| Notion, Atlassian, Cal.com     | Other      | Knowledge import, tickets, bookings               |

See the [Plugin API docs](https://hay.chat/docs/technical/plugins/api-reference/) for the plugin development guide.

### Webchat Widget

Embed the chat widget on any website:

```html
<script>
  window.HayChat = {
    config: {
      organizationId: "your-org-id",
      baseUrl: "https://your-api-domain.com",
      // ePrivacy consent mode: no cookies/storage until the first user interaction
      consent: "strict",
      position: "right",
      theme: "blue",
      greetingMessage: "Hi! How can we help?",
      // Shown next to the chat button before it is opened. Overrides Settings > Webchat.
      teaserMessage: "Questions? Chat with us!",
    },
  };
</script>
<script src="https://your-api-domain.com/v1/webchat/widget.js" async></script>
```

To show or change the teaser later (after a delay, on scroll, on a given page), call
`window.HayChat.setTeaserMessage("Still deciding? Ask us anything")` once `widget.js` has loaded; an
empty string removes it.

If you use a cookie banner, set `window.HayChat.config` only after the user accepts:

```html
<script>
  function onConsentAccepted() {
    window.HayChat = window.HayChat || {};
    window.HayChat.config = {
      organizationId: "your-org-id",
      baseUrl: "https://your-api-domain.com",
      consent: "strict",
    };
    const s = document.createElement("script");
    s.src = "https://your-api-domain.com/v1/webchat/widget.js";
    s.async = true;
    document.head.appendChild(s);
  }
</script>
```

Features: real-time messaging, typing indicators, agent avatars, unread badge, i18n support, and custom context injection via `window.HayChat.addContext()`.

## Documentation

- [Overview](https://hay.chat/docs/technical/)
- [Architecture](https://hay.chat/docs/technical/architecture/)
- [Context API](https://hay.chat/docs/technical/context-api/)
- [Guardrails](https://hay.chat/docs/technical/guardrails/)
- [Plugin Getting Started](https://hay.chat/docs/technical/plugins/getting-started/)
- [Plugin API Reference](https://hay.chat/docs/technical/plugins/api-reference/)
- [Channel Architecture](https://hay.chat/docs/technical/plugins/channel-architecture/)
- [Contributing](https://hay.chat/docs/technical/contributing/orchestrator/)

## License

[Hay Community License v1.0](LICENSE) — free to use, modify, and deploy, but you may not sell the software itself or remove the "Powered by Hay" attribution from the chat widget. See the full [LICENSE](LICENSE) for details.
