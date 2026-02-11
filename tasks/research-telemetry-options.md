# Research: Telemetry for Open Source Hay

## Context

Hay wants to add telemetry to its open source version to understand feature usage, adoption patterns, and identify areas for improvement. PostHog is currently used (presumably in the cloud/commercial version), but the open source codebase has **zero telemetry integration** today — no PostHog, no analytics SDK, no event tracking of any kind. The question is whether PostHog works for the open source edition, or if something else is better.

---

## Current State

- **No external telemetry exists** in the codebase — confirmed by full search
- The existing `analytics.service.ts` and `analytics.ts` store are for **internal business analytics** (conversation metrics, sentiment) served to the dashboard — not product telemetry
- No PostHog SDK, no tracking scripts, no event collection anywhere

---

## Does PostHog Work for Open Source Telemetry?

**Short answer: Yes, but with caveats.**

### PostHog Cloud (Recommended path if using PostHog)

- Free tier: 1M events/month, 5k session recordings, 1M feature flag requests
- Simple integration: drop in the JS/Node SDK, point at PostHog Cloud
- Full product analytics: funnels, retention, feature flags, A/B testing
- **Trade-off**: telemetry data leaves the user's infrastructure and goes to PostHog's servers — some open source users will object to this

### PostHog Self-Hosted (Not recommended)

- The supported, paid self-hosted option has been **discontinued** — PostHog now pushes everyone to Cloud
- A "hobby" Docker deployment still exists but is **unsupported, capped at ~100k events/month**, and users report significant difficulty running it
- Community consensus: self-hosting PostHog is effectively deprecated for production use

**Verdict on PostHog**: Use PostHog Cloud for Hay's own analytics needs (the team tracking how the OSS version is used). Don't require self-hosters to run PostHog infrastructure. The SDK is lightweight and sends data to PostHog Cloud — this is the standard pattern.

---

## Alternative Approaches

### Option A: PostHog Cloud SDK (Simplest)

Send anonymous telemetry events to Hay's PostHog Cloud instance.

- **Pros**: Full product analytics suite, free tier is generous, already familiar to the team
- **Cons**: Data goes to a third party (PostHog), some OSS users will be wary
- **Effort**: Low — add `posthog-node` SDK, instrument key events

### Option B: Custom Lightweight Telemetry Endpoint (Most Control)

Build a minimal telemetry service: the Hay server sends anonymous HTTP POST events to a Hay-controlled endpoint (e.g., `telemetry.hay.so`).

This is the pattern used by **Next.js, Nuxt, Astro, and many other open source projects**.

- **Pros**: Full control over data, no third-party dependency, can be as minimal as needed, complete transparency
- **Cons**: Need to build and host a collection endpoint + storage, no built-in dashboards
- **Effort**: Medium — build a telemetry module + a small collection service
- **Backend for collection**: Could still pipe into PostHog Cloud, or use a simple database

### Option C: OpenTelemetry (Overkill)

Full observability framework with traces, metrics, logs.

- **Pros**: Vendor-neutral standard, massive ecosystem
- **Cons**: Designed for infrastructure observability, not product analytics. Way too complex for "which features do users use?"
- **Verdict**: **Not appropriate** for this use case

### Option D: Plausible / Umami (Wrong tool)

Privacy-first web analytics.

- **Pros**: Simple, privacy-friendly, self-hostable
- **Cons**: Designed for **website visitor analytics** (pageviews, referrers, bounce rates), not server-side product telemetry. Can't track backend events like "agent created", "plugin installed", etc.
- **Verdict**: **Not appropriate** for this use case

---

## Recommendation: Option A + B Hybrid

Use **PostHog Cloud as the analytics backend**, but wrap it in a **custom telemetry module** in the Hay server that follows open source best practices:

### Architecture

```
Hay Server (Express)                    Hay Dashboard (Nuxt)
  └── TelemetryService (new)              └── PostHog JS SDK / Nuxt plugin
        ├── Collects anonymous events           ├── Page views, feature clicks
        ├── Respects opt-out settings           ├── Respects opt-out settings
        ├── Hashes all identifiers              └── Sends to PostHog Cloud
        └── Sends to PostHog Cloud
```

### What to Track (Anonymous, Aggregate-Only)

**Server-side:**

- **Instance info**: Hay version, Node.js version, OS, database type
- **Feature usage counts**: number of agents, conversations (bucketed ranges), plugins installed (by type, not config), channels active
- **Operational events**: server start, migration run, plugin installed/removed

**Frontend:**

- **Page views**: which dashboard pages are visited (anonymized)
- **Feature usage**: which UI features are clicked/used
- **Session recordings**: optional, for UX improvement (PostHog feature)

**NOT tracked (ever):**

- Organization names, user emails, user data
- Conversation content, messages
- API keys, secrets, file paths, IP addresses

### Opt-Out Mechanism (Following Industry Standard)

1. **Environment variable**: `HAY_TELEMETRY_DISABLED=1`
2. **Config file option**: `telemetry: false` in Hay config
3. **First-run notice**: Print a clear message on first startup explaining telemetry and how to disable it
4. **Debug mode**: `HAY_TELEMETRY_DEBUG=1` prints events to stderr without sending

### Implementation Plan

1. **Create `server/services/telemetry.service.ts`**
   - Singleton service with `track(event, properties)` method
   - Anonymous instance ID (random UUID, stored locally, never derived from user data)
   - SHA-256 hashing for any potentially identifying fields
   - Batching: collect events and flush periodically (every 30s or on shutdown)
   - Graceful degradation: telemetry failures never affect the application

2. **Add `posthog-node` as dependency (server)**
   - PostHog Node SDK is lightweight (~50KB)
   - Configure with Hay's PostHog Cloud project key
   - Make the backend configurable so it could be swapped later

3. **Add `posthog-js` as dependency (dashboard)**
   - Create a Nuxt plugin for PostHog initialization
   - Respect the same `HAY_TELEMETRY_DISABLED` setting (exposed via server config endpoint or runtime config)
   - Auto-capture page views and key interactions

4. **Instrument key server events**
   - `server_started` — version, node version, OS
   - `agent_created` / `agent_deleted` — count only
   - `plugin_installed` / `plugin_removed` — plugin type only
   - `conversation_created` — bucketed daily count
   - `migration_run` — migration name

5. **Add opt-out controls**
   - Check `HAY_TELEMETRY_DISABLED` env var
   - Check config file setting
   - Print first-run notice to console
   - Add `HAY_TELEMETRY_DEBUG` for transparency

6. **Document it**
   - Add a `TELEMETRY.md` explaining what's collected, why, and how to opt out
   - Link from README

### Verification

- Run server with `HAY_TELEMETRY_DEBUG=1` and verify events are printed correctly
- Run server with `HAY_TELEMETRY_DISABLED=1` and verify no events are sent
- Run tests to ensure telemetry failures don't crash the app
- Typecheck passes

---

## Decisions Made

1. **Opt-out** — Telemetry on by default with clear first-run notice and easy disable via `HAY_TELEMETRY_DISABLED=1`. This follows the Next.js/Nuxt/Astro pattern and ensures useful data volume.

2. **Server + Frontend** — Both the Express backend and the Nuxt dashboard should be instrumented. Server-side tracks operational events (agent created, plugin installed, server started). Frontend tracks UI usage patterns (pages visited, features clicked) via PostHog JS SDK.

---

## Sources

- [PostHog GitHub](https://github.com/PostHog/posthog) — MIT-licensed, self-hosted hobby deployment limited to ~100k events/month
- [Next.js Telemetry](https://nextjs.org/telemetry) — Industry-standard pattern for OSS telemetry
- [Nuxt Telemetry](https://www.npmjs.com/package/@nuxt/telemetry) — Similar pattern with hash+seed anonymization
- [IBM Telemetry](https://github.com/ibm-telemetry/telemetry-js) — CI-only collection approach
- [Transparent Telemetry (Russ Cox)](https://research.swtch.com/telemetry-intro) — Design philosophy for ethical OSS telemetry
- [Why Your OSS Project Needs Telemetry](https://1984.vc/docs/founders-handbook/eng/open-source-telemetry/) — Best practices guide
- [PostHog vs Plausible vs Umami](https://medium.com/@coders.stop/setting-up-self-hosted-analytics-posthog-plausible-umami-comparison-ac4e7e826486) — Comparison of self-hosted analytics
- [Open Source Analytics Tools](https://swetrix.com/blog/open-source-website-analytics) — Broader landscape overview
