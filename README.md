<svg width="87" height="30" viewBox="0 0 87 30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3.05176e-05" width="29.3915" height="29.3915" rx="4.66345" fill="#001BF4"></rect>
            <path d="M22.0127 20.6498C22.0127 20.6498 10.7607 21.1618 6.46616 21.1618C9.9877 8.36058 12.3068 0.423778 13.0799
                15.5293C16.172 4.69087 18.1475 2.38665 18.1475 15.1879C24.2459 1.44788 22.528 13.9931 22.0127 20.6498Z" fill="white"></path>
            <path d="M71.8383 28.6598L73.3393 26.1669C73.3393 26.1669 74.1971 26.9979 75.0281 26.9979C76.1271 26.9979 76.5828 26.6762
                77.1993 25.1215L77.7086 23.8081L71.5166 10.8077H75.0817L79.3705 20.109L82.7211 10.8077H86.179L80.0138 26.3546C78.9148
                29.1423 77.1189 30.0001 75.2425 30.0001C73.3125 30.0001 71.8383 28.6598 71.8383 28.6598Z" fill="#0F282C"></path>
            <path d="M67.784 10.8076H70.7593V23.5132H67.784V21.8513C67.784 21.8513 66.685 23.8348 63.9509 23.8348C60.6539 23.8348 57.7589
                21.0739 57.7589 17.1604C57.7589 13.2468 60.6539 10.4859 63.9509 10.4859C66.6046 10.4859 67.784 12.4695 67.784
                12.4695V10.8076ZM67.5427 19.0635V15.2572C67.5427 15.2572 66.6046 13.4881 64.5406 13.4881C62.3694 13.4881 61.0291 15.0696
                61.0291 17.1604C61.0291 19.2512 62.3694 20.8327 64.5406 20.8327C66.6046 20.8327 67.5427 19.0635 67.5427 19.0635Z" fill="#0F282C"></path>
            <path d="M52.8934 12.3891V4.74964H56.11V23.5132H52.8934V15.4448H44.8787V23.5132H41.6621V4.74964H44.8787V12.3891H52.8934Z" fill="#0F282C"></path>
          </svg>

AI-powered customer support platform. Automate conversations with configurable AI agents, train them on your knowledge base, and integrate with your existing tools — all from a single dashboard.

[Website](https://hay.chat) · [Documentation](docs/)

![GitHub commit activity](https://img.shields.io/github/commit-activity/m/hay-chat/hay-core)
![GitHub last commit](https://img.shields.io/github/last-commit/hay-chat/hay-core)
![GitHub issues](https://img.shields.io/github/issues/hay-chat/hay-core)
![GitHub pull requests](https://img.shields.io/github/issues-pr/hay-chat/hay-core)
![GitHub repo size](https://img.shields.io/github/repo-size/hay-chat/hay-core)
![Node.js version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## What is Hay?

Hay lets businesses deploy AI agents that handle customer support 24/7 across multiple channels. Agents are grounded in your documentation, follow structured playbooks, and seamlessly escalate to humans when needed.

**Key capabilities:**

- **AI Agents** — Configure tone, instructions, and behavior. Test before deploying.
- **Knowledge Base** — Upload PDFs, Word docs, text, markdown, or import from URLs. Agents use vector search to ground answers in your content.
- **Playbooks** — Step-by-step workflows for specific scenarios (refunds, order lookups, greetings, etc.).
- **Multi-channel** — Web chat widget, WhatsApp, email, and more via plugins.
- **Human Handoff** — Automatic escalation with full conversation context.
- **Plugin Ecosystem** — Extend functionality with Stripe, HubSpot, Zendesk, WooCommerce, Magento, and more via MCP (Model Context Protocol).
- **Analytics** — Resolution rate, response time, customer satisfaction, and conversation insights.
- **Privacy** — GDPR-compliant data handling with DSAR support.

## Tech Stack

| Layer    | Technology                                          |
| -------- | --------------------------------------------------- |
| Frontend | Nuxt 3 (Vue 3), Tailwind CSS, shadcn-vue, Pinia     |
| Backend  | Express 5, tRPC v11, TypeORM                        |
| Database | PostgreSQL 16 + pgvector                            |
| Cache    | Redis 7                                             |
| AI       | OpenAI (GPT-4o, text-embedding-3-small)             |
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

- Node.js >= 18
- npm >= 9
- Docker (for PostgreSQL and Redis)

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd hay-core

# Start infrastructure
docker compose up -d

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings (see Environment Variables below)

# Run database migrations
cd server && npm run migration:run && cd ..

# Start development
npm run dev
```

The dashboard runs on `http://localhost:3000` and the API on `http://localhost:3001`.

### Environment Variables

| Variable                                                      | Required   | Description                    |
| ------------------------------------------------------------- | ---------- | ------------------------------ |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Yes        | PostgreSQL connection          |
| `REDIS_HOST`, `REDIS_PORT`                                    | Yes        | Redis connection               |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                            | Yes        | Auth secrets (min 32 chars)    |
| `OPENAI_API_KEY`                                              | Yes        | OpenAI API key for AI features |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`        | No         | Email sending                  |
| `BASE_DOMAIN`, `API_DOMAIN`, `DASHBOARD_DOMAIN`               | Production | Domain configuration           |

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

Plugins extend Hay via the Model Context Protocol (MCP). Each plugin is loaded dynamically at runtime — the core never hardcodes plugin references.

**Core plugins:**

| Plugin      | Category   | Description                         |
| ----------- | ---------- | ----------------------------------- |
| Email       | Channel    | Send emails via SMTP                |
| HubSpot     | CRM        | Contacts, companies, deals, tickets |
| Magento     | E-commerce | Products, orders, customers         |
| Stripe      | Payments   | Customers, subscriptions, invoices  |
| WooCommerce | E-commerce | Products, orders, customers         |
| Zendesk     | Help desk  | Tickets, customers, workflows       |

See [docs/PLUGIN_API.md](docs/PLUGIN_API.md) for the plugin development guide.

### Webchat Widget

Embed the chat widget on any website:

```html
<script>
  window.HayChat = {
    config: {
      organizationId: "your-org-id",
      baseUrl: "https://your-api-domain.com",
      position: "right",
      theme: "blue",
      greetingMessage: "Hi! How can we help?",
    },
  };
</script>
<script src="https://your-cdn/webchat.js" async></script>
```

Features: real-time messaging, typing indicators, agent avatars, unread badge, i18n support, and custom context injection via `window.HayChat.addContext()`.

## Documentation

- [Plugin API Reference](docs/PLUGIN_API.md)
- [Plugin Quick Reference](docs/PLUGIN_QUICK_REFERENCE.md)
- [Channel Registration Guide](docs/PLUGIN_CHANNEL_REGISTRATION.md)
- [Orchestrator Architecture](server/orchestrator/ARCHITECTURE.md)
- [Database Conventions](server/database/DATABASE_CONVENTIONS.md)

## License

MIT
