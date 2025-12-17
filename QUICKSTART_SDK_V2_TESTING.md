# Quick Start: SDK v2 Frontend Testing

## TL;DR - 5 Minute Setup

```bash
# 1. Build the email plugin
cd plugins/core/email && npm run build && cd ../../..

# 2. Start the email worker (replace YOUR_ORG_ID)
npx tsx plugin-sdk-v2/runner/index.ts \
  --plugin-path=./plugins/core/email \
  --org-id=YOUR_ORG_ID \
  --port=5556

# 3. In another terminal, verify it's working
curl http://localhost:5556/mcp/list-tools | jq

# 4. Enable the plugin in the dashboard
# Navigate to Settings → Plugins → Email → Enable
# Configure recipients: your-email@example.com

# 5. Create a playbook
# Navigate to Playbooks → Create New
# Title: "Email Test"
# Instructions: Type `/` and select "email:send-email"
# Save

# 6. Start a conversation and test
# Send: "Please send a test email with subject 'Hello' and body 'Test message'"
# Watch the tool execute in real-time!
```

## Expected Results

### ✅ Worker Startup
```
[2025-12-15T10:00:00.000Z] Initializing Email plugin
[2025-12-15T10:00:00.100Z] Email plugin config schema registered
[2025-12-15T10:00:00.200Z] Starting Email plugin for org test-org
[2025-12-15T10:00:00.300Z] Email plugin configured with 1 recipient(s)
[2025-12-15T10:00:00.400Z] MCP server 'email-mcp' started successfully
[2025-12-15T10:00:00.500Z] Email MCP server started successfully
✓ Worker ready on port 5556
```

### ✅ Tool Discovery
```bash
curl http://localhost:5556/mcp/list-tools | jq
```
```json
{
  "tools": [
    {
      "name": "healthcheck",
      "description": "Check if the email plugin is working correctly",
      "serverId": "email-mcp",
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": []
      }
    },
    {
      "name": "send-email",
      "description": "Send an email to configured recipients",
      "serverId": "email-mcp",
      "input_schema": {
        "type": "object",
        "properties": {
          "subject": { "type": "string", "description": "Email subject line" },
          "body": { "type": "string", "description": "Email body content" }
        },
        "required": ["subject", "body"]
      }
    }
  ]
}
```

### ✅ Playbook Creation
When you create the playbook, you should see tools available in the `/` action menu:
- `email:healthcheck`
- `email:send-email`

### ✅ Conversation Flow
1. Send message: "Send a test email"
2. AI thinks: "I need to use the email:send-email tool"
3. Tool executes → Worker processes request
4. Result appears in UI:
   ```
   ✅ Action completed: email:send-email

   Email sent successfully to 1 recipient(s): your-email@example.com
   Message ID: mock-1702645200000
   Subject: Test Email
   ```

## Troubleshooting

### Problem: Worker won't start
**Error:** `Cannot find module 'plugin-sdk-v2/dist/sdk/factory.js'`

**Fix:**
```bash
cd plugin-sdk-v2
npm run build
cd ..
```

### Problem: Tools not showing in playbook
**Check:**
```bash
# 1. Is worker running?
curl http://localhost:5556/mcp/list-tools

# 2. Is plugin enabled?
# Go to Settings → Plugins and check

# 3. Check database
psql -d hay -c "SELECT * FROM plugin_instances WHERE plugin_id = 'email';"
```

### Problem: Tool execution fails
**Check worker logs:** Look for errors in the terminal where worker is running

**Verify worker health:**
```bash
curl http://localhost:5556/metadata | jq
```

**Check worker state in database:**
```sql
SELECT * FROM plugin_runners WHERE plugin_id = 'email';
-- runtime_state should be 'ready'
```

## Testing Checklist

- [ ] Worker starts without errors
- [ ] `/mcp/list-tools` returns 2 tools
- [ ] Plugin enabled in dashboard
- [ ] Playbook shows email actions in `/` menu
- [ ] Conversation created with playbook
- [ ] Message sent requesting email
- [ ] AI calls tool automatically
- [ ] Result appears in UI within 5 seconds
- [ ] WebSocket shows real-time update
- [ ] Error handling works (test invalid input)

## Next: Test Your Own Plugin

Want to convert another plugin to SDK v2?

1. Copy the email plugin structure:
   ```bash
   cp -r plugins/core/email plugins/core/my-plugin
   ```

2. Modify `src/index-v2.ts`:
   - Change plugin name
   - Update config schema
   - Implement your tools in `listTools()` and `callTool()`

3. Update `package.json`:
   - Change name, displayName
   - Update main entry point

4. Build and test:
   ```bash
   cd plugins/core/my-plugin
   npm run build
   npx tsx ../../../plugin-sdk-v2/runner/index.ts \
     --plugin-path=. \
     --org-id=test-org \
     --port=5557
   ```

## Reference Documentation

- **Complete Testing Guide**: [PHASE_6_FRONTEND_INTEGRATION.md](PHASE_6_FRONTEND_INTEGRATION.md)
- **Implementation Summary**: [PHASE_6_COMPLETE_SUMMARY.md](PHASE_6_COMPLETE_SUMMARY.md)
- **Email Plugin Guide**: [EMAIL_PLUGIN_SDK_V2_CONVERSION.md](EMAIL_PLUGIN_SDK_V2_CONVERSION.md)
- **MCP Integration Details**: [PHASE_6_MCP_INTEGRATION_COMPLETE.md](PHASE_6_MCP_INTEGRATION_COMPLETE.md)

## Success! 🎉

You're now running SDK v2 plugins end-to-end through the frontend. The system is:
- ✅ Dynamically discovering tools from workers
- ✅ Executing tools via HTTP API
- ✅ Broadcasting results in real-time
- ✅ Handling errors gracefully

Ready for production use with process management and monitoring!
