# Redis down

## What users see

Redis holds rate-limit counters and the record of processed webhook deliveries.
While it's down:

- **Most rate limits** are counted per process, so limits are looser but still apply.
- **Sensitive endpoints refuse with 503:** login-related limits, password reset,
  verification resend, organization creation, and parts of the public widget.
- **Webhooks are refused with 503** because a repeat can't be told from a first
  delivery. Providers retry, so nothing is lost if Redis returns within their
  retry window.
- `/ready` returns 503. `/health` stays 200.

## Confirm

```bash
docker compose ps                       # in /srv/hay-core or selfhost/
docker compose logs --since 15m <redis-service>
docker compose exec server node -e "fetch('http://127.0.0.1:3001/ready').then(r=>r.text()).then(console.log)"
```

Metric: `hay_redis_unavailable_total` is rising, split by `surface` and `action`.

## Fix

1. Check for the usual causes: `df -h` (full disk stops AOF writes), out-of-memory
   kills (`dmesg | tail`, `docker inspect <container> --format '{{.State.OOMKilled}}'`).
2. `docker compose restart <redis-service>`.
3. If the AOF is corrupt, the log says so at start. Stop Redis and run
   `redis-check-aof --fix` on the volume. Redis holds only transient data, so
   clearing the volume is an acceptable last resort. The cost is reset rate-limit
   counters and a lost webhook replay record, so a provider's retry of a very recent
delivery could be processed twice.

The server reconnects by itself. Restart it only if `/ready` stays at 503 after Redis is healthy.

## Confirm it's over

`/ready` returns `"redis": true`, and `hay_redis_unavailable_total` stops rising.
Check that webhook-driven channels are receiving messages again.
