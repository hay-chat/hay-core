# Self-hosting Hay

This guide runs Hay on a single Linux server with Docker Compose: the API, the
dashboard, the chat widget, PostgreSQL (pgvector), Redis, RabbitMQ and a Caddy
reverse proxy that gets HTTPS certificates for you.

Hay is distributed under the [Hay Community License](LICENSE). You can run it for
your own business and your own customers. You may not sell it or offer it as a
hosted service, and the "Powered by Hay" notice in the chat widget must stay.

## Requirements

- A Linux server with Docker Engine 24+ and the Compose plugin.
- 2 vCPUs and 4 GB RAM at minimum; 8 GB is comfortable. The image build itself
  needs about 4 GB of memory.
- About 15 GB of disk for images, plus your data.
- A domain (or subdomain) whose DNS A/AAAA record points at the server, and
  ports 80 and 443 open to the internet.
- An OpenAI API key. Embeddings for knowledge base search always use OpenAI
  (`text-embedding-3-small`). Chat can use another provider; see
  [AI providers](#ai-providers).
- Optional but recommended: an SMTP account for signup, password reset and
  invite emails.

## Install

```bash
git clone https://github.com/hay-chat/hay-core.git
cd hay-core/selfhost
cp .env.example .env
```

Edit `selfhost/.env` and fill in the **REQUIRED** block:

| Variable                | What to put there                                            |
| ----------------------- | ------------------------------------------------------------ |
| `HAY_DOMAIN`            | The domain Hay will be served on, e.g. `support.example.com` |
| `DB_PASSWORD`           | Any strong password (`openssl rand -hex 32`)                 |
| `DB_APP_PASSWORD`       | Another strong password, for the app's limited database role |
| `REDIS_PASSWORD`        | Any strong password                                          |
| `RABBITMQ_PASSWORD`     | Any strong password                                          |
| `JWT_SECRET`            | 32+ random characters                                        |
| `JWT_REFRESH_SECRET`    | 32+ random characters, different from `JWT_SECRET`           |
| `PLUGIN_ENCRYPTION_KEY` | 32+ random characters; encrypts integration credentials      |
| `OPENAI_API_KEY`        | Your OpenAI key                                              |

Then build and start everything:

```bash
docker compose up -d --build
```

The first build takes 10–20 minutes. On start, a one-shot `migrate` container
creates the database schema, then the server, dashboard and Caddy come up. Watch
progress with:

```bash
docker compose ps
docker compose logs -f server
```

When `server` reports healthy, open `https://<HAY_DOMAIN>` and sign up. The first
signup creates your organization and makes you its owner.

> **Close signups after you register.** Anyone who can reach your domain can
> create their own organization until you set `ALLOW_SIGNUP=false` in `.env`
> and run `docker compose up -d` again. With signups closed, only the very first
> account (the instance owner) and people you invite can register.

## Email

Without SMTP, Hay can't send verification, password reset or invite emails. The
example config therefore sets `REQUIRE_EMAIL_VERIFICATION=false`, which marks new
signups as verified so they can log in.

To enable email, fill in the `SMTP_*` values, set `SMTP_ENABLED=true` and
`REQUIRE_EMAIL_VERIFICATION=true`, then `docker compose up -d`.

## Add the chat widget to your website

In the dashboard, open **Settings → Webchat** to get the snippet with your
organization ID. It loads the widget from your own server:

```html
<script>
  window.HayChat = {
    config: {
      organizationId: "your-org-id",
      baseUrl: "https://support.example.com",
    },
  };
</script>
<script src="https://support.example.com/v1/webchat/widget.js" async></script>
```

## Integrations

Integrations (Shopify, WooCommerce, WhatsApp, Stripe, HubSpot, ...) are plugins,
enabled per organization in **Integrations**. On hay.chat some of them connect in
one click through Hay's own OAuth apps. Those apps are not available to
self-hosted installs, so you either:

- connect with an API key / access token where the plugin offers it, or
- create your own app with the provider and enter its credentials. The example
  config sets `PLUGIN_ALLOW_MANAGED_OVERRIDE=true` so organization admins can.

For Meta channels (WhatsApp, Instagram, Messenger) the provider must be able to
reach `https://<HAY_DOMAIN>/v1/...` webhooks, so the server has to be public.

## AI providers

Each organization can choose its chat provider in **Settings → AI Models**
(OpenAI, Anthropic, Gemini or any OpenAI-compatible endpoint). To change the
default for every organization, set `LLM_BASE_URL`, `LLM_VENDOR` and
`LLM_API_KEY` in `.env`. Embeddings stay on `OPENAI_API_KEY`.

## Other optional features

All are configured in `selfhost/.env`; the example lists each one.

| Feature                          | Variables                                                |
| -------------------------------- | -------------------------------------------------------- |
| Push notifications for agents    | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Bot check on the chat widget     | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`             |
| S3-compatible file storage       | `S3_*` (default: local `uploads` volume)                 |
| Virus scan of uploaded documents | `CLAMAV_HOST`, `CLAMAV_PORT`                             |
| Telemetry                        | `POSTHOG_KEY`. Unset means no telemetry at all           |

After changing `.env`, apply it with `docker compose up -d`.

## Upgrading

```bash
cd hay-core
git pull
cd selfhost
docker compose up -d --build
```

The `migrate` container applies new database migrations before the server
restarts. **Back up first** (below): some migrations can't be reverted. Read the
[release notes](https://github.com/hay-chat/hay-core/releases) before upgrading;
Hay is pre-1.0 and releases may include breaking changes.

Upgrading from a version that ran as root or without a Redis password: add
`REDIS_PASSWORD` to `selfhost/.env`. The containers now run as an unprivileged
user (uid 10001); the one-shot `uploads-perms` container hands the uploads volume
to it. If you bind-mounted uploads from the host, `chown -R 10001:10001` that
directory yourself.

## Backups

Three things hold state:

1. **The database.**
   ```bash
   docker compose exec -T postgres pg_dump -U hay -Fc hay > hay-$(date +%F).dump
   ```
   Restore into an empty database with `pg_restore -U hay -d hay --clean`.
2. **Uploaded files**, in the `hay_uploads` volume (or your S3 bucket).
3. **`selfhost/.env`.** Without `PLUGIN_ENCRYPTION_KEY` the stored integration
   credentials can't be decrypted, and without the JWT secrets everyone is
   logged out.

Redis and RabbitMQ hold only transient data.

## Using your own proxy or managed services

- **Your own reverse proxy:** remove the `caddy` service, publish the `server`
  (port 3001) and `dashboard` (port 3000) containers, and route these paths to
  the server, everything else to the dashboard: `/v1`, `/ws`, `/plugins`,
  `/uploads`, `/github`, `/oauth/callback`, `/.well-known/oauth-client`,
  `/health`. Forward WebSocket upgrades on `/ws` and `/v1/ws`. `selfhost/Caddyfile`
  is the reference. Hay assumes HTTPS in production.
- **Managed PostgreSQL / Redis / RabbitMQ:** remove the service from
  `compose.yml` and set `DB_HOST`, `DB_PORT`, `DB_SSL=true`, `REDIS_HOST`,
  `REDIS_PASSWORD`, `REDIS_TLS` or `RABBITMQ_URL` in the `environment` block of
  the `x-hay` anchor. PostgreSQL needs pgvector 0.8+, and the database user must
  be allowed to `CREATE EXTENSION vector` and `pgcrypto`.
- **Proxy hops (`TRUST_PROXY`):** the number of reverse proxies between the
  internet and the server. The default of 1 is right for the bundled Caddy. Add
  one for each extra layer (for example 2 with Cloudflare in front of Caddy). Too
  low and every visitor appears to come from your proxy's IP, so rate limits are
  shared between them. Too high and visitors can spoof their IP with an
  `X-Forwarded-For` header. The server logs a warning at startup when it is unset.
- **Website imports:** pages are rendered in the separate `browser` container,
  which has no secrets and can't reach the databases. Without it, set
  `CHROME_REMOTE_URL` to your own Chromium's DevTools URL, or unset it to run
  Chromium inside the server container. Imports report an error while a configured
  remote browser is unreachable; Hay doesn't fall back to a local one.

## Troubleshooting

- **The site shows a certificate error:** Caddy couldn't get a certificate.
  Check that DNS points at the server and ports 80/443 are reachable, then
  `docker compose logs caddy`.
- **The server exits on start:** `docker compose logs server`. The usual cause
  is a missing or too-short `JWT_SECRET` / `JWT_REFRESH_SECRET`, or a missing
  `OPENAI_API_KEY`.
- **The AI never replies:** check RabbitMQ is healthy (`docker compose ps`) and
  look for OpenAI errors in `docker compose logs server`.
- **Can't log in after signing up:** email verification is on but email isn't
  being sent. Set `REQUIRE_EMAIL_VERIFICATION=false`, or configure SMTP, then
  verify existing users with
  `docker compose exec postgres psql -U hay -d hay -c "update users set email_verified = true"`.

Questions and bug reports: [GitHub Issues](https://github.com/hay-chat/hay-core/issues).
