#!/bin/bash
# One-time local development setup. Safe to re-run: every step is idempotent.
#
#   npm run setup
#
# 1. Checks Node and Docker
# 2. Starts Postgres (pgvector), Redis and RabbitMQ (docker-compose.yml)
# 3. Installs npm dependencies
# 4. Creates .env from .env.example with generated secrets (an existing .env
#    is kept; only empty JWT secrets are filled in)
# 5. Builds the plugin SDK and the webchat widget
# 6. Runs database migrations
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || fail "Node.js is not installed (need >= 22.12)."
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 12)) process.exit(1);
' || fail "Node.js $(node -v) is too old; need >= 22.12."
command -v docker >/dev/null || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop and re-run."
echo "Node $(node -v), Docker OK"

step "Starting Postgres, Redis and RabbitMQ"
docker compose up -d --wait

step "Installing dependencies"
npm install

step "Configuring .env"
created_env=false
if [ ! -f .env ]; then
  cp .env.example .env
  created_env=true
  echo "Created .env from .env.example"
fi
CREATED_ENV="$created_env" node - .env <<'JS'
const fs = require("fs");
const crypto = require("crypto");
const file = process.argv[2];
let env = fs.readFileSync(file, "utf8");

const get = (key) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim();
const set = (key, value) => {
  const line = new RegExp(`^#?\\s*${key}=.*$`, "m");
  env = line.test(env) ? env.replace(line, () => `${key}=${value}`) : `${env}\n${key}=${value}\n`;
  console.log(`Set ${key}`);
};

for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"]) {
  if (!get(key)) set(key, crypto.randomBytes(64).toString("hex"));
}
// No SMTP locally: let new signups log in without verifying their email.
if (process.env.CREATED_ENV === "true") set("REQUIRE_EMAIL_VERIFICATION", "false");
// Pick up an OpenAI key from the shell when .env still has the placeholder.
const openai = get("OPENAI_API_KEY");
if ((!openai || openai === "your-openai-api-key") && process.env.OPENAI_API_KEY) {
  set("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
}

fs.writeFileSync(file, env);
JS

step "Building the plugin SDK and webchat widget"
npm run build:plugin-sdk
npm run build:webchat

step "Running database migrations"
npm run migration:run

step "Creating the dev login"
(cd server && npm run --silent dev:account)

openai_key=$(grep -E '^OPENAI_API_KEY=' .env | cut -d= -f2- || true)
printf '\n\033[32mSetup complete.\033[0m\n'
if [ -z "$openai_key" ] || [ "$openai_key" = "your-openai-api-key" ]; then
  printf '\033[33mStill needed: set OPENAI_API_KEY in .env (required for AI replies and embeddings).\033[0m\n'
fi
echo "Start the app with: npm run dev"
echo "  Dashboard: http://localhost:3000  (log in as dev@hay.local / hay-dev-password)"
echo "  API:       http://localhost:3001"
