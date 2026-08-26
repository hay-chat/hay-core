# CONTEXT

**Current Task**: Agent create/update prod fix (Klevie) plus PostHog server telemetry and user identification. Six commits on `claude/agent-instructions-contract`, not pushed.

**Key Decisions**:

- `server/types/tiptap.types.ts` is the single contract for rich-text instruction jsonb columns; route, service, entity and dashboard all derive from it.
- All telemetry gates on `POSTHOG_KEY`: unset means no PostHog client, no browser script, no outbound calls. `server/lib/telemetry.ts` and `useTelemetry()` both no-op.
- App and marketing site deliberately share one PostHog project for now (id 99235); split later if signal gets noisy.

**Next Steps**:

- Push branch and deploy; confirm agent creation, custom escalation, and that `$exception` events reach PostHog through the `b.hay.chat` proxy.
- Still open: client-side `capture_exceptions: true` plus enabling error tracking in the PostHog project (account-level toggle, not done).
- Older uncommitted work also on master, see WIP.md.
