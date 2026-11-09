# Restoring the database

Decide first whether you need this. A failed migration or a few bad rows may be
better fixed forward, because a restore loses everything since the backup.

Write down the time of the incident and the backup you restore from. You need both
for step 4.

## Hosted Hay (DigitalOcean managed PostgreSQL)

The provider takes the backups. Confirm the current retention and point-in-time
window on the cluster's **Backups** page and record it here at each quarterly drill,
because it depends on the plan.

1. Stop writes: `cd /srv/hay-core && docker compose stop` on the application services.
2. In the DigitalOcean panel, **restore from backup** to a point just before the
   incident. This creates a **new cluster**, and leaves the damaged one for
   investigation. Don't delete it yet.
3. Connect the new cluster:
   - Add the production host's current public IP to its trusted sources, and point
     the job that keeps that IP up to date at the new cluster.
   - Confirm the `vector` and `pgcrypto` extensions exist and the application role
     has its grants.
   - Change the `DB_*` values in Infisical, then run `/srv/hay-core/deploy.sh
--env-only`, and check with `~/bin/infisical-env.py check /srv/hay-core`.
4. Handle erasures (below), then start the application.

**Uploads** are not covered by the provider. They live on the production host, and
nothing backs them up unless an off-site job has been set up for them. Verify one
exists before you rely on it.

## Self-hosted

```bash
cd selfhost
docker compose stop server dashboard
docker compose exec backup ls -l /backups/db          # choose a dump
docker compose exec postgres dropdb -U hay --force hay
docker compose exec postgres createdb -U hay hay
docker compose exec backup pg_restore --exit-on-error --no-owner --no-privileges -d hay /backups/db/hay-<stamp>.dump
```

Then uploads, if needed (the archive name matches the dump):

```bash
docker run --rm --user 0 --entrypoint tar -v hay_uploads:/data/uploads -v hay_backups:/backups \
  hay-backup:local -xzf /backups/uploads/hay-<stamp>.tar.gz -C /data/uploads
```

Then handle erasures and run `docker compose up -d`.

**The machine is gone:** restore from the off-site copy with restic on a new
machine. You need `RESTIC_REPOSITORY` and `RESTIC_PASSWORD`:

```bash
restic snapshots --tag hay
restic restore latest --tag hay --target ./restored
```

The snapshot contains the dump, the uploads, and `.env`. Put `.env` in `selfhost/`
first, because the encryption key must match the data.

## Before reopening: erasures

A restore brings back anything erased after the backup was taken. That includes
customer deletions made to honour legal requests, so they have to be redone before
anyone can read the data.

If this release has an erasure ledger kept outside the database, replay it. Otherwise,
take the list from the damaged database while it's still readable:

```sql
SELECT id, email, subject_type, completed_at FROM privacy_requests
WHERE type = 'deletion' AND status = 'completed' AND completed_at > '<backup time>';
```

Also check for organizations deleted since the backup, and repeat every erasure in the
restored database.

## Confirm it's over

- `/ready` returns 200, and `npm run migration:show` has nothing pending.
- A test conversation gets a reply (`hay chat send "test" --logs`).
- A plugin with stored credentials still connects. If it can't, the encryption key
  doesn't match the data.
- `SELECT * FROM audit_logs_verify_chain();` returns no rows.

## Quarterly drill

**Self-hosted:** `docker compose exec backup restore-drill.sh`. It restores the newest
dump into a scratch database, checks it, reports the time, and drops it.

**Hosted:** restore the cluster to a new temporary one in the panel, run the checks
above against it from a machine on its trusted sources, record how long it took, and
delete it. To drill with the script instead, take a dump and run it against a
throwaway `pgvector/pgvector:pg16` container, never against the production cluster.
