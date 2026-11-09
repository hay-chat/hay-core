# Audit log external copy

Every audit row is copied to an S3-compatible bucket with Object Lock, so the trail
can be checked against something an attacker with database access can't rewrite.
Rows are queued in `audit_log_outbox` in the same transaction that writes them and
shipped by the `ship-audit-log-outbox` job (every 30 seconds, one instance at a
time). A bucket outage delays copies but never blocks requests or loses rows.

Off unless `AUDIT_SINK_BUCKET` is set. The copy holds only the fields the hash
chain covers (ids, action, resource, status, actor type, timestamps, hashes), no
personal data. Objects are written once with a compliance-mode retention of
`AUDIT_SINK_RETENTION_DAYS` (default 400), so nobody can delete them earlier.

## Setup

1. Create a bucket with Object Lock enabled at creation (this also enables versioning).
   Don't set a default retention rule; Hay sets the retention on each object.
2. Create a key that can `s3:PutObject` and `s3:ListBucket` only. It needs no read
   or delete rights. Set `AUDIT_SINK_BUCKET` and, if they differ from `S3_*`,
   `AUDIT_SINK_ENDPOINT`, `AUDIT_SINK_REGION`, `AUDIT_SINK_ACCESS_KEY_ID`,
   `AUDIT_SINK_SECRET_ACCESS_KEY` (`AUDIT_SINK_FORCE_PATH_STYLE=true` for MinIO).
3. Deploy, run migrations, then `npm run audit:sink -- status` from `server/`.
   Rows written before the sink was enabled are queued by the migration and ship
   in the background.

Compliance-mode locks can't be shortened or removed by anyone, including the cloud
account owner. Test with a throwaway bucket before pointing at the real one.

## Alerts

```yaml
groups:
  - name: audit-sink
    rules:
      - alert: AuditSinkLagging
        expr: hay_audit_sink_oldest_pending_seconds > 900
        for: 10m
        annotations:
          summary: Audit rows have waited more than 15 minutes to be copied
      - alert: AuditSinkEntriesSetAside
        expr: hay_audit_sink_failed > 0
        annotations:
          summary: Audit rows gave up shipping after repeated failures
```

`hay_audit_sink_deliveries_total{outcome="retry"|"failed"|"shipped"}` shows
delivery attempts. The gauges are absent while the sink is off.

## Confirm

```bash
cd server && npm run audit:sink -- status    # {"pending":..,"failed":..,"oldestPendingSeconds":..}
docker compose logs --since 15m <server-service> | grep audit-sink
```

`last_error` on `audit_log_outbox` holds the error class and HTTP status of the
latest failure.

## Fix

- **Pending grows, `failed` is 0:** the bucket or credentials are unreachable. Fix
  that; entries retry on their own with backoff up to an hour.
- **`failed` above 0:** entries retried 20 times (about 14 hours) and were set aside.
  They still block retention. Fix the cause, then `npm run audit:sink -- retry-failed`.
  An entry with `last_error = audit_row_missing` has no audit row to copy and can be
  deleted from the outbox once you know why.
- Retention keeps any row that hasn't shipped, so a long outage grows
  `audit_logs` instead of losing history.

## Verify

```bash
cd server && npm run audit:sink -- verify
```

Runs the database chain check and compares the bucket with `audit_logs`; exits 1
on any problem. `pending` rows are lag, not a problem.

| Problem           | Meaning                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_in_sink` | A row marked shipped has no object. Check bucket logs and lifecycle rules.                                                              |
| `hash_mismatch`   | The row's hash differs from the copy: the row or chain was rewritten. Treat as an incident ([incident-response](incident-response.md)). |
| `sink_conflict`   | Two different hashes exist for one position: a forked chain.                                                                            |
| `missing_in_db`   | An object exists for a row retention did not remove: rows were deleted behind the guard.                                                |

Done when `verify` prints `0 sink problems, 0 chain problems`.
