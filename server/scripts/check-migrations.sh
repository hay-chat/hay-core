#!/bin/bash

set -e

echo "🔍 Checking database migration status..."

cd "$(dirname "$0")/.."

# Check if we can connect to the database and show migrations
if ! npx typeorm-ts-node-commonjs migration:show -d ./database/data-source.ts > /tmp/migration_check.txt 2>&1; then
  echo "❌ Failed to check migration status. Database connection or permissions issue:"
  cat /tmp/migration_check.txt | grep -E "(error|ERROR|Error)" | head -5

  exit 1
fi

# Check if there are pending migrations
if grep -q "\[ \]" /tmp/migration_check.txt; then
  echo "📦 Found pending migrations. Running migrations..."
  if ! npm run migration:run; then
    echo "❌ Failed to run migrations"
    exit 1
  fi
  echo "✅ Migrations completed successfully"
else
  echo "✅ All migrations are up to date"
fi

rm -f /tmp/migration_check.txt