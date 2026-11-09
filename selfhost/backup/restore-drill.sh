#!/usr/bin/env bash
# Proves a backup can be restored: restores a dump into a new scratch database,
# checks it, reports how long it took, and drops the scratch database. The
# source database is never touched.
#
#   restore-drill.sh [dump-file]    defaults to the newest dump in /backups/db
#
# Connection comes from the standard PG* variables. KEEP_DRILL_DB=1 keeps the
# scratch database for inspection. Any failed check exits non-zero.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/backups}
export RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}

fail() { echo "DRILL FAILED: $*" >&2; exit 1; }

dump=${1:-$(find "$BACKUP_DIR/db" -maxdepth 1 -type f -name 'hay-*.dump' | sort | tail -n 1)}
[[ -n $dump && -f $dump ]] || fail "no dump found"

scratch="hay_restore_drill_$(date -u +%Y%m%d%H%M%S)"
query() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$scratch" -c "$1"; }
cleanup() {
  if [[ ${KEEP_DRILL_DB:-0} == 1 ]]; then
    echo "kept scratch database: $scratch"
  else
    dropdb --if-exists --force "$scratch" || echo "could not drop $scratch" >&2
  fi
}

echo "dump: $dump ($(du -h "$dump" | cut -f1))"
createdb "$scratch"
trap cleanup EXIT

started=$(date +%s)
pg_restore --exit-on-error --no-owner --no-privileges -d "$scratch" "$dump"
elapsed=$(( $(date +%s) - started ))

expected=$(pg_restore --list "$dump" | grep -c ' TABLE public ' || true)
restored=$(query "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
[[ $expected -gt 0 ]] || fail "the dump lists no tables"
[[ $expected -eq $restored ]] || fail "$restored tables restored, dump lists $expected"
echo "tables: $restored"

for table in migrations organizations users conversations messages; do
  if [[ -n $(query "SELECT to_regclass('public.$table')") ]]; then
    echo "rows in $table: $(query "SELECT count(*) FROM public.$table")"
  fi
done
if [[ -n $(query "SELECT to_regclass('public.migrations')") ]]; then
  [[ $(query "SELECT count(*) FROM public.migrations") -gt 0 ]] || fail "no migrations recorded"
fi

if [[ -n $(query "SELECT to_regproc('public.audit_logs_verify_chain')") ]]; then
  problems=$(query "SELECT count(*) FROM audit_logs_verify_chain()")
  [[ $problems -eq 0 ]] || fail "audit log chain reports $problems problems"
  echo "audit log chain: intact"
fi

archive=$(find "$BACKUP_DIR/uploads" -maxdepth 1 -type f -name 'hay-*.tar.gz' 2>/dev/null | sort | tail -n 1 || true)
if [[ -n $archive ]]; then
  tar -tzf "$archive" >/dev/null || fail "uploads archive is unreadable: $archive"
  echo "uploads archive readable: $archive"
fi

if [[ -n ${RESTIC_REPOSITORY:-} ]]; then
  restic check --quiet || fail "off-site repository check failed"
  echo "off-site repository: intact, latest snapshots:"
  restic snapshots --tag hay --latest 1
fi

echo "DRILL PASSED restore_seconds=$elapsed"
