# Rotating secrets

Rotate at once if a secret leaked or someone with access left. Otherwise rotate
yearly, and treat any secret that appeared in a log, a ticket or a chat as leaked.

**Applying a change.** Hosted: update Infisical, run `/srv/hay-core/deploy.sh
--env-only`, then `~/bin/infisical-env.py check /srv/hay-core`. Never edit
`/srv/hay-core/.env`. Self-hosted: edit `selfhost/.env`, then `docker compose up -d`.

Generate values with `openssl rand -hex 32`. Hex also avoids shell quoting problems
in generated env files.

| Secret                                                                 | Effect of rotating                                                               | Steps                                                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                                           | Every session ends. Audit correlation of failed logins by hashed email restarts. | Change and apply.                                                                                                                                          |
| `JWT_REFRESH_SECRET`                                                   | Every session ends. Must differ from `JWT_SECRET`.                               | Change and apply.                                                                                                                                          |
| `INTERNAL_API_SECRET`                                                  | Callers using the old value get refused.                                         | Change it in the server and every caller together.                                                                                                         |
| `OPENAI_API_KEY`, `LLM_API_KEY`, `OPENAI_EU_API_KEY`                   | None if done in order.                                                           | Create the new key, apply, confirm a reply, then revoke the old one.                                                                                       |
| `DB_PASSWORD`                                                          | Brief outage.                                                                    | Hosted: reset in the DigitalOcean panel, update Infisical, apply. Self-hosted: `ALTER USER` first, then change `.env`. The `backup` container uses it too. |
| `REDIS_PASSWORD`                                                       | Brief degradation (see [redis-down](redis-down.md)).                             | Change and recreate Redis and the server together.                                                                                                         |
| `RABBITMQ_PASSWORD`                                                    | Brief degradation.                                                               | The variable only applies at first boot, so first run `rabbitmqctl change_password <user> <new>`, then change and apply.                                   |
| `RESEND_WEBHOOK_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`                   | Webhooks fail between the two steps; providers retry.                            | Rotate at the provider, then apply straight away.                                                                                                          |
| OAuth client secrets, `S3_SECRET_ACCESS_KEY`, `GITHUB_APP_PRIVATE_KEY` | None if done in order.                                                           | Add the new one at the provider, apply, verify, revoke the old one.                                                                                        |
| `VAPID_PRIVATE_KEY`                                                    | Existing browser push subscriptions stop working until users re-subscribe.       | Only rotate if it leaked. Change the public and private keys together.                                                                                     |
| `RESTIC_PASSWORD`                                                      | None.                                                                            | `restic key add`, update `.env` and the off-site copy of the password, `restic key remove <old-id>`.                                                       |
| `PLUGIN_ENCRYPTION_KEY`                                                | See below.                                                                       | See below.                                                                                                                                                 |

## `PLUGIN_ENCRYPTION_KEY`

**There's no way to rotate this key in place today.** Only one key is read at a time,
and no tool re-encrypts existing values. Changing it makes these stored values
unreadable:

- plugin credentials and encrypted config on plugin instances (`plugin_instances`)
- plugin state (`plugin_states`)
- each organization's own LLM API key
- each organization's webchat identity secret

TODO: add a re-encryption command that reads with the old key and writes with the new
one, so this can be done routinely.

**If the key leaked**, re-encrypting wouldn't be enough anyway, because whoever has
the key and a database copy can read the old credentials. Treat it as an incident:

1. Revoke what the key protected, at each provider, for every connected organization.
2. Set a new key and apply. Plugin credentials encrypted with the old key read as
   empty; organization LLM keys and webchat identity secrets raise errors until
   they are replaced.
3. Have customers reconnect their integrations, and issue new webchat identity
   secrets. Tell customers who embed that secret to update their sites.
4. Keep the old key out of new backups, and record which backups still need it.

Old backups need the key that was current when they were taken. Keep retired keys
in the secrets manager until the last backup using them has expired.
