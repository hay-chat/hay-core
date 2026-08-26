# Lessons Learned

## 2026-02-26: Security Review (HAY-80 branch)

### Inverted condition bug in sandbox env var blocklist
- **Failure mode**: `if (!baseEnv[varName]) delete sandboxEnv[varName]` — deletes only vars that DON'T exist (no-op), keeps dangerous vars
- **Detection signal**: Code review / security audit
- **Prevention**: Always test sandbox isolation with actual dangerous env vars present

### Pino redact `*` only covers 1 nesting level
- **Failure mode**: `*.password` catches `{a: {password}}` but NOT `{a: {b: {password}}}`
- **Prevention**: Generate paths at multiple depths (`field`, `*.field`, `*.*.field`)

### JWT access/refresh token confusion
- **Failure mode**: Same secret + no `type` claim = tokens are interchangeable
- **Prevention**: Always use separate signing secrets AND a `type` discriminator claim for different token types

### Timing-unsafe string comparison on HMAC signatures
- **Failure mode**: `===` leaks timing information on signature verification
- **Prevention**: Always use `crypto.timingSafeEqual()` for any secret/signature comparison

### Plugin manifest can request arbitrary host env vars
- **Failure mode**: Plugin `env` field in manifest could request `JWT_SECRET`, `DB_PASSWORD`, etc.
- **Prevention**: Maintain a deny-list of sensitive env vars that plugins can never access

### Password reset token O(n) argon2 scan
- **Failure mode**: `verifyResetToken` loads ALL users with pending resets and runs argon2 verify on each — O(n) expensive operations, potential DoS
- **Prevention**: Use SHA-256 for high-entropy tokens (256-bit random) instead of argon2. SHA-256 enables direct DB lookup. Argon2 is only needed for low-entropy secrets (passwords)

### optionalAuth swallows authorization errors
- **Failure mode**: `catch {}` suppresses ALL errors including FORBIDDEN, so a user with invalid org access silently becomes unauthenticated instead of getting an error
- **Prevention**: Only catch authentication failures; re-throw authorization errors (FORBIDDEN)

### Dynamic column names in SQL queries
- **Failure mode**: `entity.${userInput}` in TypeORM query builder allows SQL injection through filter/sort/search field names
- **Prevention**: Validate all dynamic identifiers against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before interpolation

### enabled_tools not enforced server-side
- **Failure mode**: LLM can call any tool regardless of the conversation's `enabled_tools` list — prompt injection could trigger unauthorized tool execution
- **Prevention**: Check `conversation.enabled_tools` before every tool execution in the orchestrator loop

### Plugin tRPC routers registered only at server boot
- **Failure mode**: A plugin built/installed/enabled while the server was running had no router in `pluginRouterRegistry` until an unrelated restart. `documentSources.listRoots` and the sync engine failed with "does not expose a router". nodemon only watches `server/**/*.ts`, so plugin `dist/*.cjs` builds never triggered a restart.
- **Detection signal**: tRPC BAD_REQUEST "Plugin 'X' does not expose a router with listRoots" despite the manifest having `autoActivate`+`trpcRouter` and `dist/router.cjs` existing on disk.
- **Prevention**: Registration must be self-healing, not boot-only. Added idempotent `pluginManagerService.ensurePluginRouterRegistered(pluginId)`; on-demand router consumers (listRoots, sync `resolveImporter`) call it before `getRouter`.

### `as unknown as` cast hid a broken client/server contract
- **Failure mode**: Agent create/update rejected every payload for ~3 months. Commit 561f3fd ("eliminate all eslint any") retyped Tiptap instruction fields from `z.any()` to `z.array(z.unknown())`, but the editor sends a document object `{type:"doc",content:[]}`. The dashboard's `toInstructionsInput` used `(value ?? {blocks:[]}) as unknown as InstructionsInput`, so the double cast silenced the type error that would have caught it at build time.
- **Detection signal**: tRPC BAD_REQUEST with no server-side log line; the UI showed only a generic "please try again" toast.
- **Prevention**: When replacing `any` with a concrete type, derive the type from the actual runtime payload (check the producer), don't guess from the column name — `instructions` sounds plural but is a single document. Never bridge a client/server shape mismatch with `as unknown as`; if a cast is needed, narrow with a runtime check first (`value?.type === "doc"`). Declare the shape once in a shared module and let both sides infer from it.

### Silent tRPC failures — no onError handler
- **Failure mode**: `createExpressMiddleware` was mounted without `onError`, so every failed procedure (validation, auth, unhandled throw) went back to the client and was never written to the logs. A production incident had zero server-side evidence.
- **Detection signal**: grepping `hay-server-out.log` for the failing procedure name returns nothing at all, while the client clearly receives an error.
- **Prevention**: Always attach `onError` when mounting a tRPC adapter. Log `path`, `type`, `code` and the error; omit `input`, which can carry customer data.

### Type-guessing a jsonb column duplicated the bug downstream
- **Failure mode**: The same wrong "instructions is an array" assumption appeared in `orchestrator/run.ts`, which gated both human-handoff branches on `Array.isArray(instructions) && length > 0`. Always false for a Tiptap doc, so agents' configured escalation instructions silently never ran and the default handoff always fired — no error, just missing behaviour.
- **Detection signal**: A configured feature that never takes effect, with no log line, and a truthiness/shape check sitting between the config and the behaviour.
- **Prevention**: When you fix a shape mismatch, grep for every consumer of that column before closing. Encode the "is this populated" question as one shared predicate (`hasTiptapContent`) rather than re-deriving it per call site.
