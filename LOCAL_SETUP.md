# Local Development Setup Guide

This guide will help you set up the local development environment for Hay.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ and npm installed
- Git

## Quick Start

### 1. Start the Database Services

```bash
# Start PostgreSQL + pgvector and Redis
docker compose up -d

# Check that services are running
docker compose ps

# View logs if needed
docker compose logs -f postgres
docker compose logs -f redis
```

### 2. Configure Environment Variables

The project uses environment-specific configuration files:

- **`.env.local`** - Local development (Docker)
- **`.env.cloud`** - Cloud/production environment
- **`.env`** - Symlink to the active environment

**Switch between environments:**

```bash
# Switch to local development
npm run env:local

# Switch to cloud environment
npm run env:cloud

# Check current environment
npm run env:status
```

Your environment should already be set to **local** with these settings:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=hay
DB_PASSWORD=hay_password
DB_NAME=hay_db
DB_SSL=false

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

**Note:** Your OpenAI API key and other credentials are already configured in both environment files.

### 3. Install Dependencies

```bash
# Install all dependencies (root + all workspaces)
npm install
```

### 4. Run Database Migrations

```bash
# Navigate to server directory
cd server

# Run migrations to set up the database schema
npm run migration:run

# Verify migrations were applied
npm run migration:show
```

### 5. Start the Application

```bash
# Go back to root directory
cd ..

# Start both server and dashboard in development mode
npm run dev
```

The application will be available at:
- **Dashboard:** http://localhost:3000
- **API Server:** http://localhost:3001

## Useful Commands

### Database Management

```bash
cd server

# Run pending migrations
npm run migration:run

# Generate a new migration (after entity changes)
npm run migration:generate -- ./database/migrations/YourMigrationName

# Show migration status
npm run migration:show

# Revert last migration
npm run migration:revert
```

### Docker Commands

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Stop and remove volumes (WARNING: deletes all data)
docker compose down -v

# View logs
docker compose logs -f

# Restart a service
docker compose restart postgres
docker compose restart redis

# Connect to PostgreSQL
docker compose exec postgres psql -U hay -d hay_db

# Connect to Redis CLI
docker compose exec redis redis-cli
```

### Database Access

#### PostgreSQL

```bash
# Using Docker
docker compose exec postgres psql -U hay -d hay_db

# Or if you have psql installed locally
psql -h localhost -p 5432 -U hay -d hay_db
# Password: hay_password
```

#### Redis

```bash
# Using Docker
docker compose exec redis redis-cli

# Or if you have redis-cli installed locally
redis-cli -h localhost -p 6379
```

## Troubleshooting

### Port Already in Use

If you get errors about ports 5432 or 6379 being in use:

```bash
# Check what's using the port
lsof -i :5432
lsof -i :6379

# Stop conflicting services
# For PostgreSQL
brew services stop postgresql

# For Redis
brew services stop redis
```

### Database Connection Errors

1. Verify containers are running:
   ```bash
   docker compose ps
   ```

2. Check container logs:
   ```bash
   docker compose logs postgres
   ```

3. Verify pgvector extension:
   ```bash
   docker compose exec postgres psql -U hay -d hay_db -c "SELECT * FROM pg_extension WHERE extname = 'vector';"
   ```

### Reset Database

If you need to start fresh:

```bash
# Stop services and remove volumes
docker compose down -v

# Start services again
docker compose up -d

# Run migrations
cd server && npm run migration:run
```

### Migration Errors

If migrations fail:

1. Check database connectivity
2. Verify no manual schema changes were made
3. Review migration files in `server/database/migrations/`
4. Check the logs for specific SQL errors

## Alternative: Local PostgreSQL Installation

If you prefer not to use Docker:

### macOS (Homebrew)

```bash
# Install PostgreSQL
brew install postgresql@16

# Install pgvector
brew install pgvector

# Start PostgreSQL
brew services start postgresql@16

# Create database and user
createuser hay
createdb -O hay hay_db

# Enable pgvector extension
psql -d hay_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Install Redis

```bash
# Install Redis
brew install redis

# Start Redis
brew services start redis
```

Then update your `.env` to use these local services (same settings should work).

## Next Steps

After setup is complete:

1. Create your first organization and user account
2. Configure plugins in the dashboard
3. Set up OpenAI API key for AI features
4. Explore the API documentation at http://localhost:3001/docs (if enabled)

For more information, see the main [README.md](README.md) and [CLAUDE.md](CLAUDE.md).
