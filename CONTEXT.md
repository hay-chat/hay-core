# CONTEXT

**Current Task**: Fixed production agent create/update failure (Klevie) — Tiptap instruction payload rejected by the zod schema. Implemented, uncommitted on master.

**Key Decisions**:

- `server/types/tiptap.types.ts` is the single contract for rich-text instruction jsonb columns (`tiptapDocSchema` + `hasTiptapContent`); route, service, entity and dashboard all derive from it instead of redeclaring the shape.
- Added `onError` to the tRPC express middleware (logger module `trpc`) — failed procedures were never logged, which is why this was undiagnosable from prod.
- Namespaced `dashboard/i18n/locales/*/agents.json` under an `agents` key; it was flat and collided with `playbooks.json`'s `toast` block.

**Next Steps**:

- Deploy, then confirm with Klevie that agent creation and custom human-handoff escalation both work.
- Consider auditing other routes for the same `z.array(z.unknown())`-vs-Tiptap-doc mismatch introduced by 561f3fd.
- Commit + PR when asked (older uncommitted work also on master, see WIP.md).
