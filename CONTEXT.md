# Context

**Current Task**: VOC roadmap, bottom-up lane: Wave 4 phase 1 (D18 Nuvemshop OAuth, D19 quick check, D20 plugin setup) is live on prod and the Nuvemshop partner OAuth connect is verified on a demo store. Source of truth: `tasks/voc-roadmap.md` ("Resume here" top entry).

**Key Decisions**:

- Merge straight to master, deploy with `/srv/hay-core/deploy.sh` (`--env-only` for env), run migrations from the host (`cd server && npm run migration:run`), verify live in Chrome.
- Secrets live in Infisical prod; report keys only as set/missing. Never wait on `pgrep -f deploy.sh` (it matches its own wait loop).
- D19 quick check is off for every org (`quickCheck.enabled`); D20 managed overrides off (`PLUGIN_ALLOW_MANAGED_OVERRIDE`).

**Next Steps**:

- iPhone push test (step 9): Roger re-adds the PWA, allows notifications, sends a test alert.
- Nuvemshop: seed the demo store (product + test order) and test tool reads; LGPD HMAC check; post-connect redirect fix; then Dados de publicação (ask Roger first).
- D19/D20 phase 2 (see the Wave 4 section of the roadmap).
