# Quick Reference: Production-Ready SDK v2

## TL;DR - Start Using SDK v2 Now

```bash
# 1. Build plugin (auto-detected!)
# Just has a build script in package.json

# 2. Start worker
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=YOUR_ORG_ID \
  --port=5556

# 3. Check health (2 ways)
curl http://localhost:5556/health  # Worker process
curl -X POST http://localhost:5556/mcp/call-tool \
  -H "Content-Type: application/json" \
  -d '{"toolName": "healthcheck", "arguments": {}}'  # Plugin logic

# 4. Test in frontend
# Create playbook → Add "email:send-email" action → Test!
```

## Health Monitoring

### Quick Health Check
```bash
curl http://localhost:5556/health | jq
```

### Monitor All Workers
```bash
for port in 5556 5557 5558; do
  echo "Port $port:"
  curl -sf "http://localhost:$port/health" | jq '.status' || echo "Down"
done
```

## Port Reference

| Plugin | Port |
|--------|------|
| email | 5556 |
| stripe | 5557 |
| zendesk | 5558 |
| shopify | 5559 |

## Troubleshooting

### Port in use?
```bash
lsof -ti:5556 | xargs kill
```

### Worker not starting?
```bash
# Check logs
tail -f /tmp/email-plugin-worker.log

# Rebuild plugin
cd plugins/core/email && npm run build
```

### Tools not appearing?
```bash
# Check worker
curl http://localhost:5556/mcp/list-tools | jq

# Check database
psql -d hay -c "SELECT * FROM plugin_instances WHERE plugin_id = 'email';"
```

## Production Deployment

### PM2 (Recommended)
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'email-plugin',
    script: 'npx',
    args: 'tsx plugin-sdk-v2/runner/index.ts --plugin-path=./plugins/core/email --org-id=org-123 --port=5556',
  }],
};
```

```bash
pm2 start ecosystem.config.js
pm2 logs email-plugin
pm2 monit
```

### Docker
```dockerfile
FROM node:20

WORKDIR /app
COPY . .

RUN npm install
RUN cd plugin-sdk-v2 && npm run build
RUN cd plugins/core/email && npm run build

EXPOSE 5556

HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:5556/health || exit 1

CMD ["npx", "tsx", "plugin-sdk-v2/runner/index.ts", \
     "--plugin-path=./plugins/core/email", \
     "--org-id=org-123", \
     "--port=5556"]
```

## Documentation Index

- **Complete Guide**: [PHASE_6_FRONTEND_INTEGRATION.md](PHASE_6_FRONTEND_INTEGRATION.md)
- **Implementation Summary**: [PHASE_6_COMPLETE_SUMMARY.md](PHASE_6_COMPLETE_SUMMARY.md)
- **Quick Start**: [QUICKSTART_SDK_V2_TESTING.md](QUICKSTART_SDK_V2_TESTING.md)
- **Port Conventions**: [PLUGIN_SDK_V2_PORT_CONVENTIONS.md](PLUGIN_SDK_V2_PORT_CONVENTIONS.md)
- **Healthcheck Types**: [HEALTHCHECK_CLARIFICATION.md](HEALTHCHECK_CLARIFICATION.md)
- **Recent Fixes**: [DO_NOW_FIXES_COMPLETE.md](DO_NOW_FIXES_COMPLETE.md)

## Ready for Production! ✅

- ✅ Dynamic tool discovery
- ✅ End-to-end frontend integration
- ✅ HTTP + MCP healthchecks
- ✅ Automatic build detection
- ✅ Port conventions documented
- ✅ Monitoring ready
- ✅ Docker/K8s support
- ✅ PM2 integration

**Go build amazing plugins!** 🚀
