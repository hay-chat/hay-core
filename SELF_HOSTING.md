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

## Help center

Each organization can publish a public help center: a website with its articles,
served by the Hay server itself. A help center gets a built-in address,
`<subdomain>.<HELP_CENTER_DOMAIN>`, and can also be connected to a domain the
organization owns, such as `help.acme.com`.

The feature is off until you set `HELP_CENTER_DOMAIN`. To turn it on:

1. Pick a domain or subdomain reserved for help centers, for example
   `help.example.com`. It must not be `HAY_DOMAIN`. A different registered domain
   from the dashboard's is the safer choice, because help centers show content
   written by your organizations and browsers treat subdomains of one domain as
   the same site.
2. Create a wildcard DNS record `*.help.example.com` (A, and AAAA if you use
   IPv6) pointing at the server. The bare `help.example.com` needs no record;
   nothing is served there.
3. Set `HELP_CENTER_DOMAIN=help.example.com` in `selfhost/.env` (host name only,
   no `https://`) and run `docker compose up -d`.

Sites are then reachable at addresses like `https://acme.help.example.com`.

**Certificates.** Caddy gets a separate certificate for each help center
hostname, the first time someone requests it. That first request takes a few
seconds. Before asking Let's Encrypt, Caddy asks the server whether the hostname
is a help center it serves (`/internal/help-center/tls-ask`, reachable only
inside the Docker network). The server says yes for an existing subdomain or a
verified custom domain and no for anything else, so a stranger who points a
domain at your server gets no certificate and can't use up your rate limits.

**Custom domains.** In the dashboard, an organization enters its domain and is
shown a CNAME record to create at its own DNS provider, pointing at
`hc-<random>.<HELP_CENTER_DOMAIN>`. Your wildcard record makes that name resolve
to your server. Once Hay has verified the record, the first visit to the custom
domain gets its certificate. For that to work the server must be reachable on
ports 80 and 443 under the customer's domain, so the domain has to resolve
straight to this machine and not to a CDN or proxy that ends TLS in front of it.

**Rate limits.** Let's Encrypt issues a limited number of new certificates per
registered domain per week (50 at the time of writing). Every help center
subdomain counts towards the limit of `HELP_CENTER_DOMAIN`'s registered domain,
together with `HAY_DOMAIN` if they share one. Custom domains count against the
customer's domain, not yours. A handful of help centers is fine. If your
instance will create many, serve the subdomains with one wildcard certificate
instead: build Caddy with the module for your DNS provider
([how](https://caddyserver.com/docs/build#xcaddy)), and add a site for the
wildcard to `selfhost/Caddyfile`, above the `https://` block. With Cloudflare
DNS, for example:

```
*.{$HELP_CENTER_DOMAIN} {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
	@internal path /internal /internal/*
	respond @internal 404
	reverse_proxy server:3001
}
```

Pass `HELP_CENTER_DOMAIN` and the token to the `caddy` service in `compose.yml`.
Keep the `https://` block: custom domains still get their certificates on demand.

## Other optional features

All are configured in `selfhost/.env`; the example lists each one.

| Feature                          | Variables                                                |
| -------------------------------- | -------------------------------------------------------- |
| Public help centers              | `HELP_CENTER_DOMAIN`. See [Help center](#help-center)    |
| Push notifications for agents    | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Bot check on the chat widget     | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`             |
| S3-compatible file storage       | `S3_*` (default: local `uploads` volume)                 |
| Virus scan of uploaded documents | `CLAMAV_HOST`, `CLAMAV_PORT`                             |
| Telemetry                        | `POSTHOG_KEY`. Unset means no telemetry at all           |

After changing `.env`, apply it with `docker compose up -d`.

## Plugin isolation

Plugins run as small worker processes. By default they are children of the server: they share its user, its files and its network, so a faulty or hostile plugin can reach whatever the server can. The server logs one warning at start-up while this is the case.

To run workers in their own container, with their own sandbox and a controlled way out, add to `.env`:

```
PLUGIN_ISOLATION=strict
COMPOSE_PROFILES=plugin-isolation
```

and run `docker compose up -d`. This starts two more containers:

- `plugin-host` runs the workers. It has no network at all, none of the server's environment, no route to the database, Redis or RabbitMQ, a read-only filesystem, no capabilities, and memory, process and CPU limits. It talks to the server and the proxy over unix sockets on shared volumes. It never gets the Docker socket.
- `plugin-egress` is the only way out. Each worker may reach only the hosts its plugin declares in `hay-plugin.network.egress` (plus hosts taken from the organization's own settings, such as a store URL). It resolves names itself and refuses internal addresses (loopback, private ranges, link-local, shared address space, IPv6 unique-local, multicast, IPv4-mapped) and IP literals.

Inside `plugin-host`, workers are separated from each other in the strongest way the host allows. The tier is chosen at start-up and shown in the `plugin-host` log, in the `/ready` response (`pluginIsolation`) and in the `hay_plugin_isolation_tier` metric:

| Tier | Mechanism                                                                                                                                                              | What the host must allow                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | A bubblewrap sandbox per worker: its own mount, process, network, IPC and user namespaces, a filesystem containing only the SDK and that plugin, and a seccomp filter. | Unprivileged user namespaces. `compose.yml` already applies a seccomp profile that permits them. `compose.yml` also sets `apparmor=unconfined` on `plugin-host` only, because `docker-default` AppArmor denies the `mount` calls the sandbox needs. Hosts that restrict unprivileged user namespaces by sysctl (Ubuntu 24.04 and later) need that relaxed too, or tier 2. |
| 2    | One user id per worker.                                                                                                                                                | Start `plugin-host` as root with four capabilities: `docker compose -f compose.yml -f plugin-host-uid.yml up -d`.                                                                                                                                  |
| 3    | Nothing between plugins: only the container around them.                                                                                                               | Nothing. This is the last resort and is logged as an error at every start.                                                                                                                                                                         |

`PLUGIN_ISOLATION=strict` refuses to start custom (uploaded) plugins at tier 3; bundled plugins still run, with the error logged. `PLUGIN_ISOLATION=degraded` runs custom plugins at tier 3 too. Leave `PLUGIN_ISOLATION` unset to keep today's behaviour.

To see what your host allows before enabling it, start the isolated containers and read the tier: `docker compose logs plugin-host | head`. If it reports tier 3, the log line carries the exact error from the kernel or from bubblewrap.

Start-up verifies a real sandbox: bubblewrap must start a worker with its own mount namespace and the seccomp filter must refuse a nested user namespace. If either fails, the plugin host does not claim tier 1; it logs the exact error at ERROR level and uses the next tier. Workers run without `/proc`, so a fresh `/proc` mount is not required of the host.

Network attachment: `plugin-host` has no network (`network_mode: none`) and must never be attached to your reverse proxy's network or to any network shared with other applications or datastores. Only `plugin-egress` has an outbound route, on a network of its own that no other service joins. If you run Hay behind a shared proxy network, attach only the server to it.

A possible later tier: Landlock (file and TCP-port restrictions without a namespace) where the kernel offers it. It is not built.

Limits to know about:

- At tier 3 the egress rules still apply to honest plugins but are advisory against a hostile one, which can reach the proxy's control socket.
- Workers on the same tier share the container's memory and CPU limits; there is no per-plugin cap.
- Private-network targets (a self-hosted service on your LAN) are refused by the proxy. Reach them through a public host name.
- Plugins that open raw TCP connections (not HTTP) have no route. None of the bundled plugins do.

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

The `backup` container takes a database dump and an uploads archive once a day
into the `hay_backups` volume, keeping 7 daily, 4 weekly and 6 monthly copies
(`BACKUP_*` in `.env`). It shows as unhealthy in `docker compose ps` when the last
good backup is more than two intervals old.

**Backups on the same disk don't survive losing the disk.** Set `RESTIC_REPOSITORY`
and `RESTIC_PASSWORD` in `.env` to also keep an encrypted copy elsewhere (any
[restic S3 or REST repository](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)).
That copy holds the dump, the uploads, and `selfhost/.env`. Store `RESTIC_PASSWORD`
outside this machine as well: without it the copy can't be read.

Without restic, save `selfhost/.env` yourself. Without its
`PLUGIN_ENCRYPTION_KEY` the stored integration credentials can't be decrypted,
and without the JWT secrets everyone is logged out. Redis and RabbitMQ hold only
transient data. If uploads are on S3, use that bucket's versioning.

Take one now, and rehearse a restore every quarter. The drill restores the newest
dump into a scratch database, checks it, and drops it:

```bash
docker compose exec backup backup.sh --once
docker compose exec backup restore-drill.sh
```

To restore for real, see [`runbooks/db-restore.md`](runbooks/db-restore.md). Other
runbooks for outages, key rotation and incidents are in [`runbooks/`](runbooks/).

## Monitoring

The server exposes Prometheus metrics at `/metrics` on port 9464, separately from
the application port and never through the reverse proxy. By default it listens
on loopback inside the server container, so you can read it with:

```bash
docker compose exec server node -e "fetch('http://127.0.0.1:9464/metrics').then(r=>r.text()).then(console.log)"
```

To scrape from a Prometheus container, set `METRICS_HOST=0.0.0.0` and a long
random `METRICS_TOKEN` in `selfhost/.env`, attach Prometheus to the `hay_default`
network, and configure `authorization: { credentials: <token> }` on the scrape
job with target `server:9464`. Without a token the server won't listen on anything
but loopback. Set `METRICS_PORT=0` to turn the endpoint off.

Alert on at least these:

```yaml
- alert: HayDependencyDown
  expr: hay_dependency_up == 0
  for: 2m
- alert: HayRedisDegraded # rate limits are per process, or requests are refused
  expr: increase(hay_redis_unavailable_total[5m]) > 0
- alert: HayDeadLetters # messages or conversations that used up their retries
  expr: increase(hay_dead_letters_total[15m]) > 0 or hay_dead_letter_queue_depth > 0
- alert: HaySchedulerFailures
  expr: increase(hay_scheduler_runs_total{status!="success"}[1h]) > 3
- alert: HayAuditWriteFailures
  expr: increase(hay_audit_write_failures_total[5m]) > 0
- alert: HayServerErrors
  expr: rate(hay_http_requests_total{status_class="5xx"}[5m]) > 0.5
```

Also probe `/ready` from inside the Docker network (it answers 503 while the
database, Redis or RabbitMQ is down). It isn't proxied. Every response carries an
`X-Request-Id` header, every log line written for that request has the same
`requestId`, and tRPC errors return it in `error.data.requestId`, so a reported
failure can be found with `docker compose logs server | grep <id>`.

## Using your own proxy or managed services

- **Your own reverse proxy:** remove the `caddy` service, publish the `server`
  (port 3001) and `dashboard` (port 3000) containers, and route these paths to
  the server, everything else to the dashboard: `/v1`, `/ws`, `/plugins`,
  `/uploads`, `/github`, `/oauth/callback`, `/.well-known/oauth-client`,
  `/health`. Forward WebSocket upgrades on `/ws` and `/v1/ws`. `selfhost/Caddyfile`
  is the reference. Hay assumes HTTPS in production. Never route `/internal/*`
  to the server from outside: those endpoints are for the proxy itself.
- **Help centers behind your own proxy:** send every request for a subdomain of
  `HELP_CENTER_DOMAIN`, and for each connected custom domain, to the server
  (port 3001), all paths except `/internal/*`, with the `Host` header unchanged:
  the server picks the site from it. Certificates are yours to issue. A wildcard
  certificate covers the subdomains. Custom domains need one each; if your proxy
  can issue on demand, have it ask
  `http://server:3001/internal/help-center/tls-ask?domain=<host>` first (200 =
  issue, 404 = refuse). A CDN in front of the wildcard record generally breaks
  custom domains, because customers' CNAMEs then point at the CDN, which doesn't
  know their domain. Keep that record DNS-only unless your CDN has a feature for
  customer hostnames.
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
- **A help center shows a certificate error:** Caddy was refused or couldn't get
  a certificate for that hostname. Check `HELP_CENTER_DOMAIN` is set, the
  wildcard DNS record (or the customer's CNAME) resolves to the server, and for
  a custom domain that the dashboard shows it as verified. `docker compose logs
  caddy` shows the refusal or the Let's Encrypt error, including rate limits.
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
