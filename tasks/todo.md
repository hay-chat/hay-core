# Security, Compliance, Architecture & Production-Readiness Audit

## Plan
- [x] Survey repo layout, entry points, CI, deployment config
- [x] Fan out domain audits (auth/sessions, API authz/tenancy, uploads/SSRF, plugins, AI, frontend/webchat, privacy/infra, code quality)
- [x] Independently verify every Critical and High claim against source
- [x] Synthesize findings into the 21-section report with scores and roadmap
- [x] Verify: findings carry file:line evidence; no secret values in the report
- [x] Commit, push branch, open draft PR (#113)

## Acceptance criteria
- Report follows the 21 requested sections, plus Production Readiness Score and 4-horizon roadmap — done
- Every issue: description, abuse path, impact, legal implication where relevant, severity, remediation, type — done
- Claims grounded in actual code (file:line); unverified items listed in Appendix B — done

## Results
- Report delivered out-of-repo (scratchpad + chat attachment) because `hay-chat/hay-core` is public and the
  report contains working exploit paths for unpatched Critical/High issues. Commit it to the repo (suggested
  path `docs/SECURITY_AUDIT_2026-10.md`) only after the Section 19 items are fixed and deployed.
- Headline: 6 Critical, 24 High, 38 Medium, 20 Low. Overall readiness 45/100.
- Criticals: cross-tenant `auth.listUsers`/`deactivateUser`; plugin registry hijack by `pluginId`;
  tenant plugin code executes in the core process (`npm run build`, in-process `trpcRouter`), `ALLOW_CUSTOM_PLUGINS` unwired;
  config `env:` reads any host env var; workers bind 0.0.0.0 with no auth; unauthenticated plugin proxy reaches
  `/setup/status` and `/webchat/gate`.

## Working notes
- No helmet / security headers on API or dashboard; CORS credentials:true with dynamic default list
- express.json limit 50mb global; multer memoryStorage for plugin ZIPs
- server/dump.rdb committed (tiny, rate-limit keys only)
- server/package.json contains dashboard/dev deps in `dependencies` → npm audit --omit=dev: 12 critical / 70 high
- SIGTERM handler does not close HTTP server, scheduler or DB pool before exit
- `config.rateLimit` and `config.plugins.allowCustomPlugins` are defined and never read
