# hay CLI (internal test tool)

Goal: test chat, conversations, plugins and server logs from the terminal, without Claude in Chrome.
Branch `claude/hay-cli`, worktree `.claude/worktrees/claude+hay-cli`.

## Acceptance criteria

- `hay chat send "<msg>" --logs` on prod posts as a webchat customer, waits for the reply, prints it with the server log lines of that conversation.
- `hay orgs`, `hay use <org>`, `hay conv list`, `hay conv show <id>`, `hay logs <id|--since 5m>`, `hay plugins list|test`.
- Every command takes `--json`; plain output is compact text.
- Credentials live in `~/.config/hay-cli/config.json` (mode 600), never in the repo.
- No new dependencies; runs with the repo's `tsx`.

## Decisions

- Location `tools/hay-cli/` (own tsconfig + vitest tests), root script `npm run hay`, shim `tools/hay-cli/bin/hay`.
- Plain fetch against tRPC (no transformer on the server), no AppRouter type import: it drags the whole server type graph and `@server/*` paths into the CLI typecheck.
- Auth: login/register JWT + rotating refresh token (API keys are org-scoped synthetic members, so no `orgs`/`use`). An `apiKey` in the profile is also accepted.
- Webchat path: `publicConversations.create/sendMessage/getMessages` with DPoP proofs (ES256 via node webcrypto). Keys + nonce per conversation in `~/.config/hay-cli/conversations.json` so `--conversation <id>` can continue.
- Reply detection: poll `getMessages` until a non-customer message follows ours and `typing` is false, then one settle poll.
- Logs: prod = `docker logs hay-server --since` (JSON pino lines), filtered by conversation id; local = a file (`HAY_LOCAL_LOG_FILE`), since the dev server only prints to its terminal.
- `plugins call`: no server endpoint executes a plugin tool outside a conversation; stubbed with an explanation.

## Checklist

- [x] Read CLAUDE.md, WIP.md, lessons, auth middleware, routes, webchat path
- [x] Test user/org on prod: roger+cli@hay.chat, org "Hay CLI Test" (6e09a8b0-fa09-408c-81ca-a98532c238c1)
- [x] args/duration parsing, config store, API client with refresh
- [x] DPoP + chat send/wait
- [x] conv list/show, orgs/use, plugins list/test/tools
- [x] logs (docker/file) + filter/format
- [x] Server: conversation id on every log line of an orchestrator run (retrieval lines had none)
- [x] Unit tests (vitest --root tools/hay-cli; jest for the logger context)
- [x] Verify: lint, typecheck, tests, real prod round trip
- [x] README, CLAUDE.md note, WIP.md entry, commits

## Results

- `tools/hay-cli/` (src: args, config, api, dpop, webchat, logs, format, commands, main; bin/hay; tests; README).
- Server: `withLogContext` + pino mixin in `server/lib/logger/index.ts`; the orchestrator worker wraps each run, so
  retrieval/tool/LLM lines without their own id get `conversationId`. Needs a prod deploy before those lines show up
  in `hay logs <id>` (perception/run/execution lines already carry it).
- Verified on prod: `hay chat send "Do you ship to Portugal?" --logs` (new conversation, reply in ~6 s, 24 log lines),
  `--conversation` continuation, `conv show`, `conv list --json`, `plugins list|tools|test`, `whoami`, `orgs`.
- Tests: 33 vitest (CLI) + 2 jest (logger context). `tsc` CLI + server clean, eslint clean on touched files.
- Findings while testing: vector search took 16.5 s on an org with zero documents (first turn); the agent answered
  "Yes, we do ship to Portugal!" with no documents (the always-fact-check branch is not deployed yet).
- Open: `plugins call` needs a server endpoint; test user's email is unverified, so `hay login` fails until the
  verification link is clicked (the CLI runs on the refresh token from registration meanwhile).
