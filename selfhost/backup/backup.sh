#!/usr/bin/env bash
# Database dump and uploads archive, with daily/weekly/monthly retention and an
# optional encrypted off-site copy through restic.
#
#   backup.sh --loop    run whenever a backup is due (the container's default)
#   backup.sh --once    one backup now; non-zero exit on any failure
#   backup.sh --check   healthy if the last success is recent enough
#
# Connection comes from the standard PG* variables.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/data/uploads}
ENV_FILE=${ENV_FILE:-/config/hay.env}
INTERVAL=${BACKUP_INTERVAL_SECONDS:-86400}
KEEP_DAILY=${BACKUP_KEEP_DAILY:-7}
KEEP_WEEKLY=${BACKUP_KEEP_WEEKLY:-4}
KEEP_MONTHLY=${BACKUP_KEEP_MONTHLY:-6}
LAST_SUCCESS="$BACKUP_DIR/.last-success"
export RESTIC_CACHE_DIR=${RESTIC_CACHE_DIR:-$BACKUP_DIR/.restic-cache}

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Keep the newest file of each of the most recent days, ISO weeks and months.
prune() {
  local dir=$1 file stamp day month week keep
  local -A days=() weeks=() months=()
  [[ -d $dir ]] || return 0
  while IFS= read -r file; do
    stamp=${file#hay-}
    day=${stamp:0:8}
    month=${stamp:0:6}
    week=$(date -ud "${day:0:4}-${day:4:2}-${day:6:2}" +%G%V)
    keep=0
    if [[ -z ${days[$day]:-} && ${#days[@]} -lt $KEEP_DAILY ]]; then
      days[$day]=1 keep=1
    fi
    if [[ -z ${weeks[$week]:-} && ${#weeks[@]} -lt $KEEP_WEEKLY ]]; then
      weeks[$week]=1 keep=1
    fi
    if [[ -z ${months[$month]:-} && ${#months[@]} -lt $KEEP_MONTHLY ]]; then
      months[$month]=1 keep=1
    fi
    if [[ $keep -eq 0 ]]; then
      log "removing expired $file"
      rm -f -- "${dir:?}/${file:?}"
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name 'hay-*' ! -name '*.partial' -printf '%f\n' | sort -r)
}

offsite() {
  local dump=$1
  local -a paths=("$dump")
  [[ -d $UPLOADS_DIR ]] && paths+=("$UPLOADS_DIR")
  if [[ -r $ENV_FILE ]]; then
    paths+=("$ENV_FILE")
  else
    log "WARNING: $ENV_FILE is not readable, so it is not in the off-site copy"
  fi

  restic cat config >/dev/null 2>&1 || restic init
  restic backup --quiet --tag hay "${paths[@]}"
  restic forget --quiet --tag hay --group-by tags --prune \
    --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY"
}

run_backup() {
  local stamp dump
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$BACKUP_DIR/db"
  find "$BACKUP_DIR" -maxdepth 2 -name '*.partial' -delete

  dump="$BACKUP_DIR/db/hay-$stamp.dump"
  pg_dump -Fc --file "$dump.partial"
  # A dump that can't be listed can't be restored.
  pg_restore --list "$dump.partial" >/dev/null
  mv "$dump.partial" "$dump"
  log "database dumped: $dump ($(du -h "$dump" | cut -f1))"

  if [[ -n ${RESTIC_REPOSITORY:-} ]]; then
    offsite "$dump"
    log "off-site copy complete"
  else
    log "WARNING: RESTIC_REPOSITORY is unset, backups exist only on this machine"
    if [[ -d $UPLOADS_DIR ]]; then
      local archive="$BACKUP_DIR/uploads/hay-$stamp.tar.gz" status=0
      mkdir -p "$BACKUP_DIR/uploads"
      tar -C "$UPLOADS_DIR" -czf "$archive.partial" . || status=$?
      # Exit code 1 means a file changed while it was read, expected on a live volume.
      [[ $status -le 1 ]] || { log "uploads archive failed"; return "$status"; }
      mv "$archive.partial" "$archive"
      prune "$BACKUP_DIR/uploads"
    fi
  fi

  # Old copies are only removed after this run has fully succeeded.
  prune "$BACKUP_DIR/db"
  touch "$LAST_SUCCESS"
  log "backup complete"
}

age_of_last_success() {
  [[ -f $LAST_SUCCESS ]] || { echo -1; return; }
  echo $(( $(date +%s) - $(stat -c %Y "$LAST_SUCCESS") ))
}

case ${1:---loop} in
  --once) run_backup ;;
  --check)
    age=$(age_of_last_success)
    [[ $age -ge 0 && $age -lt $(( INTERVAL * 2 )) ]]
    ;;
  --loop)
    while true; do
      age=$(age_of_last_success)
      if [[ $age -lt 0 || $age -ge $INTERVAL ]]; then
        # A separate process, so a failure in any step stops that run.
        "$0" --once || log "BACKUP FAILED, retrying within the hour"
      fi
      sleep 3600
    done
    ;;
  *) echo "usage: $0 [--loop|--once|--check]" >&2; exit 2 ;;
esac
