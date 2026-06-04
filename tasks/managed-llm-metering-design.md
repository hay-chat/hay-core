# Managed LLM Metering — Design (Draft)

> Status: **design only, not scheduled.** This documents "what we should do" so the
> LLM provider adapter (PR 1) is built with the right hooks and we don't have to
> re-touch every call site later. Nothing here is implemented yet.

## Why this exists

Hay will have three ways to pay for LLM usage:

| Mode                   | Whose keys                      | Metering needed?                                   |
| ---------------------- | ------------------------------- | -------------------------------------------------- |
| **OSS / self-hosted**  | operator's env keys             | no                                                 |
| **BYO keys (managed)** | the org's own keys              | no (their bill) — usage _analytics_ optional       |
| **Auto (managed)**     | Hay's keys, included in pricing | **yes — this is the whole reason this doc exists** |

Only **Auto** needs metering + enforcement: it's an open tab on our keys unless we
count tokens per org and stop/charge when a budget is exhausted.

## What exists today (the gap)

- `message.usage_metadata` (`server/database/entities/message.entity.ts`) — a per-message
  JSONB blob. Not populated consistently, never aggregated.
- `organization.limits` (`server/entities/organization.entity.ts`) — static quotas
  (maxUsers, maxDocuments…). Policy ceilings, **no usage accounting.**
- Cost estimate hardcoded to gpt-4o rates and only written to a log file
  (`server/services/core/llm.service.ts:261-265`).

There is **no** per-org token counter, no model pricing table, no quota enforcement,
no billing export. Greenfield.

## The one thing PR 1 must do for us

The adapter interface (PR 1) **must return normalized usage on every call**, even though
we won't store it yet:

```ts
interface ChatResult {
  content: string; // or async iterable when streaming
  usage: UsageRecord; // <-- always present
  model: string;
  provider: string;
}

interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

Both OpenAI (`response.usage`) and Anthropic (`message.usage`) already return this; the
adapter just normalizes it. If the interface carries usage from day one, metering bolts
on later without re-touching the ~12 call sites.

Also from PR 1: every LLM call already resolves an **org-scoped** provider config, so the
`organizationId` is in scope at every call site. Metering reuses that — no new threading.

## Proposed design

### 1. Capture

Adapter emits a `UsageRecord` per chat/embedding call (above). Tag it with a **purpose**
enum so we can break usage down: `perception | retrieval | execution | guardrail |
embedding | summary | docs_audit | playbook_gen`.

### 2. Store (append-only + rollup)

- `llm_usage_events` — append-only: `id, organization_id, provider, model, purpose,
prompt_tokens, completion_tokens, cost_usd, conversation_id?, created_at`.
- `llm_usage_daily` — rollup per `(organization_id, day)` for fast quota checks and the
  dashboard. Raw table is the source of truth; rollup is derived.

### 3. Cost

Replace the hardcoded rates with a **model pricing table** keyed by `(provider, model)` →
`{ inputPer1M, outputPer1M }`. `cost_usd = prompt/1e6 * inputPer1M + completion/1e6 * outputPer1M`.
Keep it in config/DB so prices update without a deploy.

### 4. Enforce (Auto mode only)

- Extend `organization.limits` with a budget unit (see open question: credits vs tokens).
- **Pre-call** check against `llm_usage_daily` rollup (cheap). Soft-warn at e.g. 80%,
  hard action at 100%.
- BYO / OSS orgs are **exempt** from enforcement — they may still get read-only analytics.

### 5. Surface

- Dashboard usage page: per org, per period, broken down by `purpose` and model.
- Show remaining budget for Auto-mode orgs.

### 6. Bill

- Export `llm_usage_daily` to billing (Stripe metered usage, or internal invoicing).
  Detail deferred.

## Phasing

- **Phase A — Observability.** Capture + store `llm_usage_events`. No enforcement.
  Validates our token/cost numbers against the provider's real invoice before we gate anything.
- **Phase B — Surfacing.** Rollups + dashboard usage page.
- **Phase C — Enforcement.** Budgets on `organization.limits`, pre-call checks, overage policy.

## Open questions

1. **Unit: credits or raw tokens?** Credits abstract away model price differences and let us
   mark up; raw tokens are transparent but couple pricing to provider rates.
2. **Overage policy:** hard block, or allow + bill the overage? (Support tooling that hard-blocks
   mid-conversation is a bad UX — leaning allow-with-cap + alert.)
3. **Do BYO orgs get analytics?** Probably yes (observability only, no enforcement) — but it
   means metering can't be Auto-only at the capture layer.
4. **Embeddings:** managed-only and shared, so embedding spend is _ours_ regardless of the org's
   chat mode. Do we attribute embedding cost back to orgs for analytics, or treat it as platform overhead?

## Dependency summary

- **Needs PR 1** to expose `UsageRecord` from the adapter and resolve org-scoped config.
- Independent of the chat-provider selection — works the same whether an org is on OpenAI,
  Anthropic, or a custom baseURL, because usage is normalized in the adapter.
