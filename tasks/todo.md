# Documentation Audit - 2025-05-25

## Plan

- [x] Initialize: checkout docs submodule, create branch
- [x] Launch audit agents for all 30 doc files
- [ ] Collect all agent reports
- [ ] Categorize: UP_TO_DATE / NEEDS_UPDATE / MAJOR_REWRITE
- [ ] Apply fixes for NEEDS_UPDATE files
- [ ] Create PR with summary

## Acceptance Criteria

- Every doc file audited against current codebase
- Factual inaccuracies fixed (file paths, function names, API routes, entity fields)
- MAJOR_REWRITE files listed in PR for manual attention
- PR created with summary table of findings

## Working Notes

- 30 doc files found in docs/ submodule
- Branch: docs/audit-20260525
- Recent codebase changes: Klaviyo plugin, HNSW index fix, centralized logger, Chatwoot plugin, ePrivacy consent
