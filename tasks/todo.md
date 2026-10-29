# Security, Compliance, Architecture & Production-Readiness Audit

## Plan
- [x] Survey repo layout, entry points, CI, deployment config
- [x] Fan out domain audits (auth/sessions, API authz/tenancy, uploads/SSRF, plugins, AI, frontend/webchat, privacy/infra, code quality)
- [ ] Independently verify core claims (headers, CORS, rate limiting, shutdown, secrets hygiene)
- [ ] Synthesize findings into docs/SECURITY_AUDIT_2026-10.md (21 sections + scores + roadmap)
- [ ] Verify: every finding has file:line evidence; no secret values pasted
- [ ] Commit, push branch, open draft PR

## Acceptance criteria
- Report follows the 21 requested sections, plus Production Readiness Score and 4-horizon roadmap
- Every issue: description, abuse path, business impact, legal implication where relevant, severity, remediation, type (architectural/implementation/operational)
- Claims grounded in actual code (file:line), unverified items marked as such

## Working notes
- No helmet / security headers on API; CORS credentials:true with dynamic default list
- express.json limit 50mb global; multer memoryStorage for plugin ZIPs
- server/dump.rdb committed (tiny, rate-limit keys only)
- server/package.json contains dashboard/dev deps (nuxt, vue, jest, eslint, @nuxt/devtools:latest) in dependencies
- SIGTERM handler does not close HTTP server/DB pool before exit
