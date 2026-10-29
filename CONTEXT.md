# Context

**Current Task**: Pre-chat forms / form messages (hay-chat/hay-core#61) rebased onto master on `claude/happy-gates-f9a54x`; CI green on hay-chat/hay-core#115 (draft); waiting on review.

**Key Decisions**:

- `@hay/form-schema` is a root workspace package: the server uses its CommonJS build (built on install via `prepare`), dashboard and webchat alias straight to `packages/form-schema/src`.
- `validateResponse` is plain TypeScript (no zod) so the widget stays inside its 48 KB brotli budget; the form components and the submit request load lazily; chat budget raised 48 → 52 KB (master was at 48.0).
- Migrations renumbered to 1785960000000/1785960000001 (after the latest on master).

**Next Steps**:

- Run `cd server && npm run migration:run` where the PR deploys.
- Verify end to end with `hay chat send` on an org with a pre-chat form, and an `ASK_FORM` playbook turn.
- Decide whether pre-chat forms stay on the roadmap (the original PR left that open).
