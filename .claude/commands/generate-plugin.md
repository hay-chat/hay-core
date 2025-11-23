---
description: Generate a Hay plugin from an MCP server GitHub repository
---

# Generate MCP Plugin

I need you to create a Hay plugin from an MCP (Model Context Protocol) server repository.

**GitHub Repository URL:** {{args}}

**Important Context:**
- Plugin directory: `/Users/rogerjunior/Documents/code/hay/hay-core/plugins`
- Schema location: `/Users/rogerjunior/Documents/code/hay/hay-core/plugins/base/plugin-manifest.schema.json`
- Workflow documentation: `/Users/rogerjunior/Documents/code/hay/hay-core/.claude/PLUGIN_GENERATION_WORKFLOW.md`
- Reference plugins: `shopify`, `stripe`, `zendesk`, `woocommerce`, `hello-world`

**Your Task:**

1. **Read the workflow documentation** at `.claude/PLUGIN_GENERATION_WORKFLOW.md` to understand the complete process
2. **Ask me the essential questions** from the "Interactive Questions for AI Agent" section:
   - Plugin name (will become `hay-plugin-{name}`)
   - Primary purpose/description (one sentence)
   - Category (integration/chat/analytics/automation/utility)
   - Authentication method(s) (oauth2/apiKey/jwt/none)
   - Configuration fields needed
   - Connection type (local/remote)
   - Transport protocol (stdio/sse/websocket/http)
   - Marketplace tags and featured status

3. **After gathering all information:**
   - Clone the repository to `/plugins/{plugin-name}/mcp/`
   - Analyze the MCP server to extract tool definitions
   - Generate complete `manifest.json` following the schema
   - Create plugin structure: `package.json`, `tsconfig.json`, `src/index.ts`
   - Install dependencies (`npm install` in both plugin root and mcp directory)
   - Build the plugin (`npm run build`)
   - Run type checks (`npm run typecheck`) to verify everything works

4. **Validation checklist** - Verify:
   - [ ] manifest.json validates against schema
   - [ ] All MCP tools are listed with correct schemas
   - [ ] Authentication configuration is complete
   - [ ] Configuration schema matches environment variables
   - [ ] Plugin compiles without errors
   - [ ] Type check passes
   - [ ] All dependencies installed

**Reference Examples:**

- **Stripe** (remote, OAuth + API Key): `/plugins/stripe/manifest.json`
- **Shopify** (local, API Key): `/plugins/shopify/manifest.json`
- **Zendesk** (local, multi-auth): `/plugins/zendesk/manifest.json`
- **Hello World** (local, no auth): `/plugins/hello-world/manifest.json`

Ask me the questions one by one, and after I answer them all, proceed with the complete implementation following the workflow documentation.
