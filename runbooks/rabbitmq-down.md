# RabbitMQ down

## What users see

RabbitMQ carries orchestrator work and outbound channel deliveries. While it's
down, nothing is lost but things slow down:

- Conversation processing and channel sends fall back to the scheduled sweeps,
  which run directly in the server, a small batch at a time. Expect slower replies.
- Pending deliveries are rows in `message_deliveries`, so a lost queue doesn't
  lose them.
- `/ready` returns 503.

## Confirm

```bash
docker compose ps
docker compose logs --since 15m <rabbitmq-service>
docker compose exec <rabbitmq-service> rabbitmq-diagnostics -q status
docker compose exec <rabbitmq-service> rabbitmqctl list_queues name messages consumers
```

Metric: `hay_queue_published_total{outcome="failed"}` is rising.

## Fix

1. Check disk first: RabbitMQ blocks publishers at its disk and memory alarms
   (`rabbitmq-diagnostics -q alarms`, `df -h`).
2. `docker compose restart <rabbitmq-service>`. The server reconnects and
   re-attaches its consumers. Restart it only if `consumers` stays at 0 after a minute.
3. If the data volume is corrupt, recreate it. Queues are declared again at server
   start, and sweeps republish due deliveries. The default user is created only on
   first boot, so the password from the environment applies again.

## Dead letters

`hay_dead_letters_total` counts work that used up its retries. This needs a person
even when RabbitMQ is healthy.

- `orchestrator.process.dead`: the conversation is flagged stuck, and the
  stale-message check retries it or hands it to a person.
- `channel.deliver.dead`: the message is marked failed, the conversation is
  flagged, and owners and admins are alerted.

Find the cause with the log lines `Conversation dead-lettered` and `Channel delivery
dead-lettered`. A depth above 0 in `hay_dead_letter_queue_depth` that doesn't drain
means the consumer isn't attached.

## Confirm it's over

`/ready` returns `"rabbitmq": true`, `consumers` is above 0 on the main queues, and
`message_deliveries` has no old rows in `pending`:

```sql
SELECT status, count(*), min(created_at) FROM message_deliveries GROUP BY status;
```
