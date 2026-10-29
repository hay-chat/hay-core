# hay CLI

Internal tool for testing chat, conversations, plugins and server logs against a
Hay backend from the terminal, without a browser. Built for Claude Code sessions:
plain compact text by default, `--json` on every command.

```bash
tools/hay-cli/bin/hay <command>        # or: npm run hay -- <command>
ln -s /srv/hay-core/repo/tools/hay-cli/bin/hay ~/.local/bin/hay   # optional
```

## Commands

| Command                                                           | What it does                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hay chat send "<msg>" [--conversation <id>] [--logs]`            | Posts as a webchat customer (same public endpoints and DPoP proofs as the widget), waits for the reply, prints the turn. Logged in, the turn includes tool calls, documents and confidence. `--logs` appends the server log lines of the conversation. `--no-wait`, `--timeout 90s`, `--lang pt-BR`. |
| `hay conv list [--status open] [--limit 20] [--page 1]`           | Conversations of the current org.                                                                                                                                                                                                                                                                    |
| `hay conv show <id> [--logs] [--verbose]`                         | Header (status, playbook, stored perception/RAG/tool log/guardrail state) + transcript with tool I/O.                                                                                                                                                                                                |
| `hay logs [<conversationId>] [--since 15m]`                       | Server logs, filtered by conversation id when given (default window 24h for a conversation, else 15m). `--log-limit 300`.                                                                                                                                                                            |
| `hay orgs` / `hay use <id\|slug\|name>`                           | List orgs of the logged-in user / set the current one.                                                                                                                                                                                                                                               |
| `hay plugins list [--all]` / `tools [<plugin>]` / `test <plugin>` | Plugins (enabled by default), MCP tools, connection test. Plugin names are matched against the org's list (`shopify` → `hay-plugin-shopify`).                                                                                                                                                        |
| `hay login --email <e>` / `logout` / `whoami`                     | Password from `HAY_PASSWORD` or stdin.                                                                                                                                                                                                                                                               |

Global flags: `--target prod|local`, `--org <id>`, `--json`, `--verbose`.
Exit codes: 0 ok, 1 error, 2 check failed (no reply before the timeout, connection test failed).

`plugins call` is not available: no server endpoint runs a plugin tool outside a
conversation. Drive the tool through `chat send` and read it back with `conv show`.

## Targets, auth and config

- Targets: `prod` = https://eu.hay.chat, `local` = http://localhost:3001. Pick with `--target`, else
  `HAY_TARGET`, else `defaultTarget` in the config, else prod.
- Config lives outside the repo in `~/.config/hay-cli/` (override `HAY_CLI_CONFIG_DIR`), mode 600:
  - `config.json`: per target `baseUrl`, `email`, `accessToken`, `refreshToken`, `organizationId`,
    optional `apiKey` (an org API key, used instead of the JWT) and `logSource`.
  - `conversations.json`: the webchat key pair and DPoP nonce of each conversation the CLI started,
    so `--conversation <id>` can continue it (last 200 kept).
- Auth is the dashboard's: `auth.login` → JWT (15 min) + rotating refresh token (90-day idle),
  refreshed automatically. The password is never stored.
- Sending a chat message needs no login (public widget path), only an org id (`hay use` or `--org`).

## Logs

- prod: `docker logs hay-server --since …` on this host (pino JSON). Every line of an orchestrator run
  carries `conversationId` (worker sets a log context), so `hay logs <id>` shows the whole run.
- local: the dev server only prints to its terminal. Tee it to a file and point the CLI at it:
  `npm run dev:server 2>&1 | tee /tmp/hay-server.log` and `HAY_LOCAL_LOG_FILE=/tmp/hay-server.log`
  (or `"logSource": {"type": "file", "path": "…"}` in the `local` target).

## Development

```bash
npm run test:hay-cli          # vitest (pure logic: args, log filter/format, transcript, DPoP)
npm run typecheck:hay-cli
npx eslint "tools/hay-cli/**/*.ts"
```

No dependencies beyond the repo's `tsx`; plain `fetch` against tRPC (the server uses no transformer).
