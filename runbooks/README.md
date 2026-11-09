# Runbooks

For the person on call. Each one starts with how to confirm the problem and ends
with how to confirm it's over.

| Runbook                                   | Use when                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [redis-down](redis-down.md)               | `hay_dependency_up{dependency="redis"}` is 0, or logins and webhooks return 503                |
| [rabbitmq-down](rabbitmq-down.md)         | `hay_dependency_up{dependency="rabbitmq"}` is 0, replies are slow, or dead letters appear      |
| [tracing-and-slos](tracing-and-slos.md)   | Turning tracing on, or wiring the reply, delivery and queue SLO alerts                         |
| [db-restore](db-restore.md)               | Data is lost or the database is unusable                                                       |
| [key-rotation](key-rotation.md)           | A secret leaked, someone with access left, or a rotation is due                                |
| [audit-sink](audit-sink.md)               | Audit copy is lagging, entries were set aside, or the trail must be checked against the bucket |
| [incident-response](incident-response.md) | Anything that may be a security incident                                                       |

**Two deployments.** Commands differ between them, so each runbook says which applies.

- **Hosted Hay (production):** application containers, Redis and RabbitMQ run as
  Docker Compose stacks on one host under `/srv`, behind Traefik. PostgreSQL is a
  DigitalOcean managed cluster. Secrets live in Infisical; `/srv/hay-core/.env` is
  generated, so never edit it by hand.
- **Self-hosted:** everything in `selfhost/compose.yml`, secrets in `selfhost/.env`.

Run `docker compose ps` in the stack's directory first to get the real service names.
