# Phase 6: Frontend Integration Complete

## Overview

This document describes the completion of frontend integration for SDK v2 MCP plugins, enabling end-to-end testing through the Hay dashboard UI.

## What Changed

### Dynamic Tool Discovery

Updated the conversation entity to fetch tools dynamically from SDK v2 workers instead of static manifest files.

**Files Modified:**
- `server/database/entities/conversation.entity.ts` (2 locations)

**Before (Static):**
```typescript
// Read from static plugin manifest files
const { pluginManagerService } = await import("../../services/plugin-manager.service");
const allPlugins = pluginManagerService.getAllPlugins();

for (const plugin of allPlugins) {
  const manifest = plugin.manifest as any;
  if (manifest?.capabilities?.mcp?.tools) {
    toolSchemas.push(...manifest.capabilities.mcp.tools);
  }
}
```

**After (Dynamic - SDK v2):**
```typescript
// Fetch from running SDK v2 workers via /mcp/list-tools
const { mcpRegistryService } = await import("../../services/mcp-registry.service");
const tools = await mcpRegistryService.getToolsForOrg(this.organization_id);

for (const tool of tools) {
  toolSchemas.push({
    name: `${tool.pluginId}:${tool.name}`, // e.g., "email:send-email"
    description: tool.description,
    input_schema: tool.input_schema,
  });
}
```

### Integration Points

The fix affects two key areas:

1. **Playbook Instructions** (`addPlaybookMessage()`)
   - When a playbook is added to a conversation
   - Tools are fetched and made available to the AI
   - Tool schemas are embedded in the playbook message

2. **Handoff Instructions** (`addHandoffInstructions()`)
   - When human agents are available/unavailable
   - Tools remain available during handoff scenarios
   - Tool schemas are embedded in handoff instructions

## Complete Integration Flow

### 1. Plugin Worker Startup

```bash
# Email plugin worker starts (SDK v2)
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=YOUR_ORG_ID \
  --port=5556
```

Worker lifecycle:
1. Loads plugin from `plugins/core/email/dist/index-v2.js`
2. Calls `onInitialize()` - registers config schema
3. Calls `onStart()` - starts local MCP server
4. MCP server registers with HTTP server
5. Exposes `/mcp/list-tools` and `/mcp/call-tool` endpoints

### 2. Tool Discovery (Frontend → Core)

When a playbook/handoff is added:

```
User creates playbook →
  Playbook references "email:send-email" →
    Conversation.addPlaybookMessage() →
      MCPRegistryService.getToolsForOrg() →
        PluginRunnerV2Service.getWorker() →
          fetch(`http://localhost:${worker.port}/mcp/list-tools`) →
            Worker routes to MCP server →
              MCP server.listTools() returns tools →
                Tools added to conversation.enabled_tools →
                  Tool schemas embedded in AI prompt
```

### 3. Tool Execution (AI → Worker)

When AI decides to call a tool:

```
AI returns CALL_TOOL step →
  ExecutionLayer handles tool call →
    ToolExecutionService.executeToolCall() →
      Parses "email:send-email" → pluginId="email", toolName="send-email" →
        MCPClientFactory.createClient() →
          fetch(`http://localhost:${worker.port}/mcp/call-tool`, {
            body: { toolName: "send-email", arguments: {...} }
          }) →
            Worker routes to MCP server →
              MCP server.callTool("send-email", args) →
                Plugin logic executes →
                  Result returned to AI →
                    Message updated in database →
                      WebSocket broadcast to frontend →
                        User sees result in UI
```

## End-to-End Testing Guide

### Prerequisites

1. **Database**: PostgreSQL running with pgvector extension
2. **Redis**: Running for WebSocket events (optional but recommended)
3. **Server**: Backend running on port 3001
4. **Dashboard**: Frontend running on port 3000
5. **Email Plugin**: Built and ready

### Step 1: Build Email Plugin

```bash
cd plugins/core/email
npm run build
```

Verify build output:
```bash
ls -la dist/index-v2.js  # Should exist
```

### Step 2: Start Email Plugin Worker

```bash
# From project root
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=YOUR_ORG_ID \
  --port=5556 \
  --mode=production
```

Expected output:
```
✓ Plugin loaded: Email
✓ Worker started on port 5556
✓ Metadata endpoint: http://localhost:5556/metadata
✓ MCP server 'email-mcp' started successfully
✓ Worker ready (PID: 12345)
```

Verify worker health:
```bash
# Check metadata endpoint
curl http://localhost:5556/metadata | jq

# List available tools
curl http://localhost:5556/mcp/list-tools | jq

# Expected output:
# {
#   "tools": [
#     { "name": "healthcheck", "description": "...", "serverId": "email-mcp" },
#     { "name": "send-email", "description": "...", "serverId": "email-mcp" }
#   ]
# }
```

### Step 3: Register Plugin Instance

In the Hay dashboard:

1. Navigate to **Settings → Plugins**
2. Find the "Email" plugin
3. Click **Enable** for your organization
4. Configure recipients: `your-email@example.com`
5. Save configuration

Alternatively via API:
```bash
curl -X POST http://localhost:3001/v1/plugins/instances \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-organization-id: YOUR_ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "pluginId": "email",
    "config": {
      "recipients": "your-email@example.com"
    }
  }'
```

### Step 4: Create a Playbook with Email Tools

1. Navigate to **Playbooks → Create New**
2. Fill in:
   - **Title**: "Email Test Playbook"
   - **Description**: "Test email plugin with SDK v2"
   - **Trigger**: "always"
3. In the instructions editor:
   - Type `/` to open the action menu
   - Select **"email:send-email"** action
   - Add instruction text: "Send a test email when the user asks for it"
4. Save the playbook

### Step 5: Start a Conversation

1. Navigate to **Conversations → New Conversation**
2. The playbook should auto-attach (trigger: "always")
3. Verify in the conversation that you see:
   ```
   📋 Playbook: Email Test Playbook

   Referenced Actions:
   - email:send-email: Send an email to configured recipients
     Input Schema: { "type": "object", "properties": { "subject": {...}, "body": {...} } }
   ```

### Step 6: Test Tool Execution

Send a message as the customer:
```
"Please send a test email with subject 'Hello from Hay' and body 'This is a test email from the SDK v2 integration'"
```

Expected flow:
1. AI receives message
2. AI decides to use `CALL_TOOL` step
3. Tool call executes: `email:send-email`
4. Message updates in real-time via WebSocket
5. You see: `✅ Action completed: email:send-email`
6. Click to expand and see result:
   ```json
   {
     "success": true,
     "message": "Email sent successfully to 1 recipient(s): your-email@example.com",
     "messageId": "mock-1234567890",
     "timestamp": "2025-12-15T10:30:00.000Z",
     "subject": "Hello from Hay",
     "bodyPreview": "This is a test email from the SDK v2 integ..."
   }
   ```

### Step 7: Verify in Browser Console

Open browser DevTools and check:

1. **WebSocket messages**:
   ```javascript
   // Should see message updates like:
   {
     type: "message_received",
     payload: {
       content: "Action completed: email:send-email",
       metadata: {
         toolOutput: { success: true, ... },
         toolStatus: "SUCCESS",
         toolLatencyMs: 123
       }
     }
   }
   ```

2. **Network requests**:
   - No direct calls to plugin worker (all routed through backend)
   - Backend makes calls to `http://localhost:5556/mcp/call-tool`

### Step 8: Test Error Handling

Send a message that will cause an error:
```
"Send an email without a subject"
```

Expected:
1. Tool call fails with validation error
2. Message shows: `❌ Action failed: email:send-email`
3. Error details displayed in metadata
4. AI receives error and can respond appropriately

## Debugging

### Enable Debug Logging

```bash
# In your .env file
LOG_LEVEL=debug
DEBUG_MODULES="orchestrator,execution,mcp"
```

### Check Worker Logs

If using the bash script:
```bash
tail -f /tmp/email-plugin-worker.log
```

If using npx tsx directly, logs appear in stdout.

### Common Issues

**Issue**: Tools not appearing in playbook
- **Check**: Is the worker running? `curl http://localhost:5556/mcp/list-tools`
- **Check**: Is the plugin instance enabled? Check database `plugin_instances` table
- **Check**: Does the worker port match? Check `plugin_runners` table

**Issue**: Tool execution fails with "worker not found"
- **Check**: `PluginRunnerV2Service.getWorker(orgId, pluginId)` returns a worker
- **Check**: Worker `runtimeState` is "ready" in database
- **Check**: Worker process is still running (not crashed)

**Issue**: Frontend doesn't show tool results
- **Check**: Redis is running (for WebSocket broadcast)
- **Check**: WebSocket connection is active in browser DevTools
- **Check**: Server logs show "Tool result broadcast via Redis/WebSocket"

## Monitoring

### Worker Health Check

```bash
# Create a simple monitoring script
watch -n 5 'curl -s http://localhost:5556/mcp/list-tools | jq ".tools | length"'
```

### Database Queries

```sql
-- Check plugin instances
SELECT id, plugin_id, enabled, runtime_state, config
FROM plugin_instances
WHERE organization_id = 'YOUR_ORG_ID';

-- Check plugin runners
SELECT * FROM plugin_runners
WHERE organization_id = 'YOUR_ORG_ID';

-- Check conversations with tools
SELECT id, enabled_tools, playbook_id
FROM conversations
WHERE enabled_tools IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

## Success Criteria

✅ Email plugin worker starts successfully
✅ Tools appear in `/mcp/list-tools` endpoint
✅ Playbook shows "email:send-email" in referenced actions
✅ Conversation has `enabled_tools = ['email:send-email']`
✅ AI can call the tool when appropriate
✅ Tool execution completes without errors
✅ Result appears in frontend UI in real-time
✅ Error cases are handled gracefully

## Next Steps

### Additional Plugins

Now that the integration is complete, you can:

1. Convert other plugins to SDK v2 (e.g., Stripe, Zendesk)
2. Test with multiple plugins simultaneously
3. Test with playbooks that use multiple tools
4. Test handoff scenarios with tools available

### Production Deployment

Before deploying to production:

1. **Process Management**: Use PM2 or similar to manage plugin workers
2. **Health Monitoring**: Set up automated health checks for workers
3. **Auto-restart**: Configure workers to restart on failure
4. **Logging**: Set up centralized logging for worker output
5. **Metrics**: Add Prometheus/Grafana metrics for tool execution

### Performance Optimization

Consider:

1. **Tool Discovery Caching**: Cache `getToolsForOrg()` results (invalidate on worker restart)
2. **Connection Pooling**: Reuse HTTP connections to workers
3. **Timeouts**: Adjust timeout values based on tool complexity
4. **Rate Limiting**: Add rate limiting for tool calls per conversation

## Conclusion

The frontend integration is now complete! Users can test MCP plugins end-to-end through the Hay dashboard UI. The integration:

- ✅ Dynamically discovers tools from SDK v2 workers
- ✅ Handles tool execution via HTTP API
- ✅ Broadcasts results in real-time via WebSocket
- ✅ Supports error handling and recovery
- ✅ Works with both playbooks and handoff scenarios

**Phase 6: Complete** 🎉
