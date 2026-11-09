# pg_dump matching the bundled database, plus restic for encrypted off-site copies.
FROM pgvector/pgvector:pg16

RUN apt-get update \
  && apt-get install -y --no-install-recommends restic ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && install -d -o 10001 -g 10001 /backups

COPY backup.sh restore-drill.sh /usr/local/bin/

USER 10001:10001
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["--loop"]
