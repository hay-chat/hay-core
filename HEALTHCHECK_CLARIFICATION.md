# Healthcheck Clarification: HTTP vs MCP

## Two Types of Healthchecks

### 1. Worker Process Health (HTTP Endpoint) ✅

**Endpoint**: `GET /health`
**Purpose**: Check if the worker process is alive and responsive
**Used by**: Infrastructure (Docker, Kubernetes, monitoring)

**What it checks:**
- Worker process is running
- HTTP server is responsive
- Basic system metrics (memory, uptime)
- Number of registered MCP servers

**Example response:**
```json
{
  "status": "healthy",
  "uptime": 3600.5,
  "timestamp": "2025-12-15T10:30:00.000Z",
  "pid": 12345,
  "orgId": "org-123",
  "mcpServers": {
    "count": 1,
    "servers": ["email-mcp"]
  },
  "memory": {
    "heapUsed": 45,
    "heapTotal": 60,
    "rss": 75
  }
}
```

**Usage:**
```bash
# Docker HEALTHCHECK
HEALTHCHECK CMD curl -f http://localhost:5556/health || exit 1

# Kubernetes liveness probe
livenessProbe:
  httpGet:
    path: /health
    port: 5556
  initialDelaySeconds: 10
  periodSeconds: 30

# Manual check
curl http://localhost:5556/health
```

---

### 2. Plugin Internal Health (MCP Tool) ✅

**Tool**: `healthcheck` (MCP tool call)
**Purpose**: Check plugin-specific business logic and configuration
**Used by**: AI agents, playbooks, monitoring tools

**What it checks:**
- Plugin configuration is valid
- Plugin-specific services are working
- Connections to external APIs (if any)
- Plugin-specific state

**Example (Email Plugin):**
```json
{
  "status": "healthy",
  "plugin": "email",
  "version": "2.0.0",
  "organizationId": "org-123",
  "recipients": ["user@example.com"],
  "recipientCount": 1,
  "message": "Email plugin is running and ready to send emails"
}
```

**Usage:**
```bash
# Via HTTP API (which calls MCP tool)
curl -X POST http://localhost:5556/mcp/call-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}'

# Via Core (tool execution service)
# AI agent in conversation calls: email:healthcheck
# Orchestrator routes to worker and executes MCP tool
```

---

## Comparison

| Aspect | HTTP /health | MCP healthcheck |
|--------|--------------|-----------------|
| **Level** | Process/Infrastructure | Plugin/Business Logic |
| **Scope** | Worker is alive | Plugin is configured & working |
| **Speed** | Very fast (~1ms) | May be slower (checks config, APIs) |
| **Caller** | Docker/K8s/Monitoring | AI/Playbooks/Frontend |
| **Response** | System metrics | Plugin-specific status |
| **Required** | Yes (infrastructure) | Optional (per plugin) |
| **Standard** | HTTP 200/503 | MCP tool response |

---

## Both Are Correct! ✅

Your email plugin **already has** the MCP `healthcheck` tool:
- ✅ Defined in `listTools()`
- ✅ Implemented in `callTool()`
- ✅ Returns plugin-specific health info

The HTTP `/health` endpoint I added is **also correct**:
- ✅ Monitors worker process health
- ✅ Used by infrastructure (Docker/K8s)
- ✅ Fast and lightweight
- ✅ Returns system metrics

---

## When to Use Each

### Use HTTP `/health`:
- Docker HEALTHCHECK directive
- Kubernetes liveness/readiness probes
- Load balancer health checks
- Monitoring systems (Prometheus, Datadog)
- PM2 process monitoring
- Quick "is the worker running?" check

### Use MCP `healthcheck` tool:
- AI agent wants to verify plugin is ready
- Playbook includes health check step
- Frontend UI showing plugin status
- Debugging plugin configuration issues
- Testing plugin-specific functionality
- Checking external API connections

---

## Example: Full Health Monitoring

### 1. Infrastructure Check (HTTP)
```bash
# Quick: Is the worker process alive?
curl http://localhost:5556/health

# Response: { "status": "healthy", "uptime": 3600, ... }
```

### 2. Plugin Check (MCP Tool)
```bash
# Detailed: Is the plugin configured and ready?
curl -X POST http://localhost:5556/mcp/call-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}'

# Response: { "status": "healthy", "recipients": [...], ... }
```

### 3. Combined Monitoring Script
```bash
#!/bin/bash

# 1. Check worker is alive
if curl -sf http://localhost:5556/health > /dev/null; then
  echo "✅ Worker process: healthy"
else
  echo "❌ Worker process: down"
  exit 1
fi

# 2. Check plugin is configured
PLUGIN_HEALTH=$(curl -s -X POST http://localhost:5556/mcp/call-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}')

if echo "$PLUGIN_HEALTH" | jq -e '.status == "healthy"' > /dev/null; then
  echo "✅ Plugin health: ready"
else
  echo "❌ Plugin health: not ready"
  echo "$PLUGIN_HEALTH"
  exit 1
fi

echo "✅ All health checks passed!"
```

---

## Recommendation

**Keep both** healthcheck mechanisms:

1. **HTTP `/health`** - For infrastructure monitoring ✅
2. **MCP `healthcheck` tool** - For plugin-specific checks ✅

They serve different purposes and are both valuable!

---

**Summary**: You were right to question this - but actually both are correct! The HTTP endpoint checks the **worker process**, while the MCP tool checks the **plugin logic**. Both are needed for complete monitoring.
