# Plugin SDK v2 - Port Conventions

## Overview

SDK v2 plugin workers expose HTTP endpoints on dedicated ports. Until automatic port allocation is implemented (Phase 7), we use **manual port conventions** to prevent conflicts.

## Port Allocation Strategy

### Current (Manual)

Each plugin type has a designated port range to prevent conflicts during development and testing.

| Plugin | Port | Status | Notes |
|--------|------|--------|-------|
| **email** | 5556 | ✅ In Use | Email plugin (SDK v2 reference implementation) |
| **stripe** | 5557 | 📋 Reserved | Payment processing |
| **zendesk** | 5558 | 📋 Reserved | Support ticketing |
| **shopify** | 5559 | 📋 Reserved | E-commerce |
| **woocommerce** | 5560 | 📋 Reserved | E-commerce |
| **magento** | 5561 | 📋 Reserved | E-commerce |
| **slack** | 5562 | 📋 Reserved | Team communication |
| **discord** | 5563 | 📋 Reserved | Team communication |
| **telegram** | 5564 | 📋 Reserved | Messaging |
| **whatsapp** | 5565 | 📋 Reserved | Messaging |
| **custom-1** | 5566 | 📋 Reserved | Custom plugins |
| **custom-2** | 5567 | 📋 Reserved | Custom plugins |
| **custom-3** | 5568 | 📋 Reserved | Custom plugins |
| ... | 5569+ | 📋 Available | Additional plugins |

### Port Range: 5556-5599

- **Start**: 5556 (first plugin port)
- **End**: 5599 (reserved for SDK v2 plugins)
- **Total**: 44 ports available

### Future (Phase 7 - Automatic)

Phase 7 will implement:
- Port pool management (5556-5599)
- Automatic allocation on worker start
- Database tracking in `plugin_runners.port` column
- Port release on worker stop
- Conflict detection and retry logic

## Usage

### Starting a Worker

**Manual port assignment:**
```bash
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=YOUR_ORG_ID \
  --port=5556
```

**Check if port is in use:**
```bash
# macOS/Linux
lsof -i :5556

# Or use netcat
nc -zv localhost 5556
```

**Kill process on port:**
```bash
# macOS/Linux
lsof -ti:5556 | xargs kill

# Or force kill
lsof -ti:5556 | xargs kill -9
```

### Multiple Organizations

Each organization gets its own worker instance **on the same port** for a given plugin.

**Example - Email plugin for 2 orgs:**
```bash
# Org 1
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=org-123 \
  --port=5556

# Org 2 (DIFFERENT PORT - conflict!)
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=org-456 \
  --port=5556  # ❌ Port already in use!
```

**Solution**: Use different ports per org (temporary until Phase 7):
```bash
# Org 1
--port=5556

# Org 2
--port=5570

# Org 3
--port=5571
```

### Multiple Plugins (Same Org)

Different plugins for the same org use different ports:

```bash
# Email plugin
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=org-123 \
  --port=5556

# Stripe plugin (same org)
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/stripe \
  --org-id=org-123 \
  --port=5557
```

## Port Discovery

### Database Query

Find which ports are in use:

```sql
SELECT
  organization_id,
  plugin_id,
  port,
  runtime_state,
  created_at
FROM plugin_runners
WHERE runtime_state IN ('starting', 'ready')
ORDER BY port;
```

### HTTP Check

Verify worker is running:

```bash
# Health check
curl http://localhost:5556/health | jq

# Metadata
curl http://localhost:5556/metadata | jq

# MCP tools
curl http://localhost:5556/mcp/list-tools | jq
```

## Port Conflicts

### Symptoms

```
Error: listen EADDRINUSE: address already in use :::5556
    at Server.setupListenHandle [as _listen2] (node:net:1463:16)
```

### Resolution

1. **Find the conflicting process:**
   ```bash
   lsof -i :5556
   ```

2. **Kill it:**
   ```bash
   kill <PID>
   ```

3. **Or use a different port:**
   ```bash
   --port=5570
   ```

### Prevention

- Document which org/plugin uses which port
- Use environment variables for port config
- Check `plugin_runners` table before starting
- Wait for Phase 7 auto-allocation

## Environment Variables

You can set default ports via environment:

```bash
# .env
EMAIL_PLUGIN_PORT=5556
STRIPE_PLUGIN_PORT=5557
ZENDESK_PLUGIN_PORT=5558
```

Then use in start command:
```bash
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=org-123 \
  --port=${EMAIL_PLUGIN_PORT}
```

## Docker/Kubernetes

When running in containers, map ports explicitly:

**Docker:**
```yaml
services:
  email-plugin-org123:
    image: hay/plugin-worker:latest
    environment:
      - PLUGIN_PATH=./plugins/core/email
      - ORG_ID=org-123
      - PORT=5556
    ports:
      - "5556:5556"
```

**Kubernetes:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: email-plugin-org123
spec:
  selector:
    app: email-plugin
    org: org-123
  ports:
    - port: 5556
      targetPort: 5556
```

## Monitoring

### Health Check Script

```bash
#!/bin/bash
# check-plugin-health.sh

PORTS=(5556 5557 5558 5559 5560)

for port in "${PORTS[@]}"; do
  echo "Checking port $port..."

  if curl -s -f "http://localhost:$port/health" > /dev/null; then
    echo "✅ Port $port: healthy"
  else
    echo "❌ Port $port: unhealthy or not running"
  fi
done
```

### PM2 Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'email-plugin-org123',
      script: 'npx',
      args: 'tsx plugin-sdk-v2/runner/index.ts --plugin-path=./plugins/core/email --org-id=org-123 --port=5556',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'stripe-plugin-org123',
      script: 'npx',
      args: 'tsx plugin-sdk-v2/runner/index.ts --plugin-path=./plugins/core/stripe --org-id=org-123 --port=5557',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

Start all:
```bash
pm2 start ecosystem.config.js
pm2 logs
pm2 status
```

## Best Practices

1. **Document port usage** - Keep this file updated when adding plugins
2. **Check before starting** - Always verify port is free
3. **Use conventions** - Stick to the port allocation table above
4. **Environment config** - Use env vars for flexibility
5. **Monitor health** - Set up automated health checks
6. **Plan for scale** - Remember this is temporary until Phase 7

## Troubleshooting

### "Port already in use"

```bash
# Find what's using the port
lsof -i :5556

# Kill it
lsof -ti:5556 | xargs kill

# Or restart with different port
--port=5570
```

### "Connection refused"

```bash
# Check if worker is running
ps aux | grep "plugin-sdk-v2/runner"

# Check if port is listening
lsof -i :5556

# Check worker logs
tail -f /tmp/email-plugin-worker.log
```

### "Worker not found"

```sql
-- Check database
SELECT * FROM plugin_runners
WHERE organization_id = 'org-123'
AND plugin_id = 'email';

-- Should show port and runtime_state = 'ready'
```

## Future Improvements (Phase 7)

When Phase 7 is implemented, this manual process will be replaced with:

- **Port Pool**: Automatic allocation from pool (5556-5599)
- **Database Tracking**: Port stored in `plugin_runners.port`
- **Conflict Detection**: Automatic retry with different port
- **Health Monitoring**: Periodic checks and auto-restart
- **Load Balancing**: Multiple workers per plugin (round-robin)

Until then, use the conventions documented here to prevent conflicts.

---

**Last Updated**: 2025-12-15
**Status**: Manual port allocation (Phase 6)
**Next**: Automatic port allocation (Phase 7)
