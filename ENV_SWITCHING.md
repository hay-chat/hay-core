# Environment Switching Guide

This project supports easy switching between local and cloud environments.

## How It Works

The `.env` file is a **symbolic link** that points to either:
- `.env.local` - Local development environment (Docker databases)
- `.env.cloud` - Cloud/production environment (DigitalOcean databases)

## Quick Commands

```bash
# Switch to local development environment
npm run env:local

# Switch to cloud/production environment
npm run env:cloud

# Check which environment is active
npm run env:status
```

## Manual Switching (Alternative)

You can also use the script directly:

```bash
./scripts/switch-env.sh local   # Switch to local
./scripts/switch-env.sh cloud   # Switch to cloud
./scripts/switch-env.sh status  # Check status
```

## Environment Differences

### Local Environment (.env.local)

- **Database**: localhost:5432 (Docker PostgreSQL)
- **Redis**: localhost:6379 (Docker Redis)
- **SSL/TLS**: Disabled
- **Logging**: Debug level enabled
- **Use for**: Local development, testing, debugging

### Cloud Environment (.env.cloud)

- **Database**: DigitalOcean managed database
- **Redis**: DigitalOcean managed Redis (Valkey)
- **SSL/TLS**: Enabled
- **Logging**: Info level
- **Use for**: Staging, production, cloud deployments

## Workflow Examples

### Starting Local Development

```bash
# 1. Switch to local environment
npm run env:local

# 2. Start Docker services
docker compose up -d

# 3. Run migrations
npm run migration:run

# 4. Start the app
npm run dev
```

### Deploying to Cloud

```bash
# 1. Switch to cloud environment
npm run env:cloud

# 2. Build the application
npm run build

# 3. Deploy (your deployment process here)
```

### Quick Environment Check

```bash
# See which environment is active
npm run env:status

# Output example:
# Current environment: local
# (.env is a symlink to .env.local)
```

## Git Configuration

Both `.env.local` and `.env.cloud` are in `.gitignore` to prevent committing secrets.

The `.env` symlink is also ignored, so each developer can maintain their own environment preference.

## Troubleshooting

### .env is not a symlink

If you see this warning when running `npm run env:status`:

```bash
npm run env:local  # This will fix it
```

### Changes not taking effect

After switching environments, restart your application:

```bash
# Kill any running processes
npm run kill-ports

# Start fresh
npm run dev
```

### Database connection errors after switching

Make sure the services for your target environment are running:

**For local:**
```bash
docker compose ps  # Verify Docker services are up
```

**For cloud:**
```bash
# Verify VPN/network access to cloud databases
# Check firewall rules if needed
```

## Best Practices

1. **Always check environment before running migrations**
   ```bash
   npm run env:status  # Verify you're on the right environment!
   npm run migration:run
   ```

2. **Use local for development**
   - Faster iteration
   - No impact on production data
   - Works offline

3. **Use cloud for final testing**
   - Test with production-like infrastructure
   - Validate SSL/TLS connections
   - Test managed service integrations

4. **Never commit .env files**
   - Both `.env.local` and `.env.cloud` contain secrets
   - They are already in `.gitignore`
   - Share environment templates via `.env.example`
