# Simple HTTP Test Plugin - Testing Guide

This document provides instructions for testing the simple-http-test plugin to validate the core plugin infrastructure.

## Prerequisites

1. **Server Running**: Ensure the Hay server is running on port 3001
   ```bash
   npm run dev
   ```

2. **Organization ID**: You'll need a valid organization ID from your database. You can get one by:
   ```sql
   SELECT id, name FROM organizations LIMIT 1;
   ```

3. **Plugin Discovered**: The plugin should be automatically discovered on server startup. Check the logs for:
   ```
   🔍 Discovering plugins...
   📦 Registered plugin: simple-http-test v1.0.0
   ```

## Test 1: Health Check via Proxy

Test that the plugin worker starts and responds to health checks via the route proxy.

```bash
# Replace {ORG_ID} with your organization ID
curl "http://localhost:3001/v1/plugins/simple-http-test/health?organizationId={ORG_ID}"
```

**Expected Response:**
```json
{
  "status": "ok",
  "plugin": "simple-http-test",
  "version": "1.0.0"
}
```

**What This Tests:**
- Plugin manager discovers the plugin
- Worker process spawns successfully
- Port allocation works (5000-6000 range)
- Health check endpoint is registered
- Route proxy forwards requests correctly

## Test 2: Ping Endpoint

Test a custom route registered by the plugin.

```bash
curl "http://localhost:3001/v1/plugins/simple-http-test/ping?organizationId={ORG_ID}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "pong",
  "timestamp": "2025-12-04T16:00:00.000Z",
  "pluginId": "simple-http-test",
  "pluginVersion": "1.0.0"
}
```

**What This Tests:**
- Custom route registration works
- Request routing through plugin SDK
- JSON response handling

## Test 3: Echo Endpoint (POST)

Test POST request handling with body parsing.

```bash
curl -X POST "http://localhost:3001/v1/plugins/simple-http-test/echo?organizationId={ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from test", "value": 42}'
```

**Expected Response:**
```json
{
  "success": true,
  "echo": {
    "message": "Hello from test",
    "value": 42
  },
  "timestamp": "2025-12-04T16:00:00.000Z",
  "headers": {
    "contentType": "application/json"
  }
}
```

**What This Tests:**
- POST request handling
- Request body parsing (express.json middleware)
- Header access

## Test 4: Config Endpoint

Test that environment variables are passed correctly to the worker.

```bash
curl "http://localhost:3001/v1/plugins/simple-http-test/config?organizationId={ORG_ID}"
```

**Expected Response:**
```json
{
  "success": true,
  "metadata": {
    "id": "simple-http-test",
    "name": "Simple HTTP Test Plugin",
    "version": "1.0.0",
    "capabilities": ["routes"]
  },
  "environment": {
    "hasApiUrl": true,
    "hasApiToken": true
  }
}
```

**What This Tests:**
- Environment variable passing (HAY_API_URL, HAY_API_TOKEN)
- Plugin metadata access
- Configuration security (sensitive values redacted)

## Test 5: Headers Endpoint

Test request header forwarding.

```bash
curl "http://localhost:3001/v1/plugins/simple-http-test/headers?organizationId={ORG_ID}" \
  -H "X-Custom-Header: test-value" \
  -H "User-Agent: curl/test"
```

**Expected Response:**
```json
{
  "success": true,
  "headers": {
    "host": "localhost:5001",
    "x-custom-header": "test-value",
    "user-agent": "curl/test",
    ...
  },
  "timestamp": "2025-12-04T16:00:00.000Z"
}
```

**What This Tests:**
- Request header forwarding from proxy to worker
- Host header rewriting
- Custom header preservation

## Test 6: Worker Lifecycle

Test that workers stay alive and clean up properly.

### Check Worker is Running

After making any request, check the worker is running:

```bash
# Check for node process running plugin worker
ps aux | grep "simple-http-test"

# Check port is allocated
lsof -i :5001  # (or whichever port was allocated)
```

### Test Keep-Alive

Wait 6 minutes (longer than the 5-minute timeout) without making requests, then try again:

```bash
# Wait 6 minutes...
# Then:
curl "http://localhost:3001/v1/plugins/simple-http-test/ping?organizationId={ORG_ID}"
```

**Expected Behavior:**
- First request after timeout should take a bit longer (worker needs to restart)
- Response should still be successful
- New worker process spawned with potentially different port

**What This Tests:**
- Worker cleanup after timeout
- Automatic worker restart on demand
- Port reallocation

## Test 7: Multiple Organizations

Test process isolation by using different organization IDs.

```bash
# First org
curl "http://localhost:3001/v1/plugins/simple-http-test/ping?organizationId={ORG_ID_1}"

# Second org
curl "http://localhost:3001/v1/plugins/simple-http-test/ping?organizationId={ORG_ID_2}"

# Check processes
ps aux | grep "simple-http-test"  # Should see 2 workers
```

**Expected Behavior:**
- Two separate worker processes running
- Different ports allocated
- Each worker has its own environment with org-specific configuration

**What This Tests:**
- Process isolation per organization
- Multiple concurrent workers
- Port management

## Troubleshooting

### Worker Doesn't Start

**Check logs:**
```bash
# Server logs should show:
[PluginManager] Starting worker for {ORG_ID}:simple-http-test
[PluginWorker] Starting plugin: simple-http-test v1.0.0
[SimpleHttpTest] Initializing plugin...
[SimpleHttpTest] Plugin initialized successfully
```

**Common issues:**
- Plugin not discovered: Check `plugins/core/simple-http-test/` exists
- Build not found: Run `cd plugins/core/simple-http-test && npm run build`
- Port unavailable: Check ports 5000-6000 range

### Health Check Fails

**Check:**
1. Worker process is running: `ps aux | grep simple-http-test`
2. Port is listening: `lsof -i | grep <port>`
3. Plugin logs for errors
4. Database has plugin registered: Check `plugin_registry` table

### Proxy Returns 401

**Issue:** Organization ID not provided or invalid

**Fix:**
- Add `?organizationId={ORG_ID}` to URL
- Use a valid organization ID from database

### Proxy Returns 503

**Issue:** Plugin worker failed to start

**Fix:**
- Check server logs for error details
- Verify plugin build exists: `ls plugins/core/simple-http-test/dist/`
- Check environment variables are set

## Success Criteria

All tests should pass, demonstrating:

- ✅ Plugin discovery works
- ✅ Worker spawning works
- ✅ Port allocation works (5000-6000 range)
- ✅ Health check passes
- ✅ Route registration works
- ✅ Request proxying works
- ✅ Environment variables passed correctly
- ✅ Worker cleanup after timeout
- ✅ Process isolation per organization
- ✅ Concurrent workers supported

## Next Steps

Once validation passes:

1. Implement MCP registration endpoints
2. Migrate email plugin (MCP-only)
3. Migrate remaining core plugins
4. Implement WhatsApp channel plugin
