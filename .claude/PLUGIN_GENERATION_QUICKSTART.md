# Quick Start: MCP Plugin Generation

## TL;DR

To generate a Hay plugin from an MCP server GitHub repository:

1. Copy the prompt from `PLUGIN_GENERATION_PROMPT.md`
2. Replace `{GITHUB_URL}` with the actual repository URL
3. Paste into Claude
4. Answer the questions Claude asks
5. Review and test the generated plugin

## Example Usage

### Step 1: Open a new Claude conversation

### Step 2: Use this prompt:

```
I need you to create a Hay plugin from the MCP server at:
https://github.com/modelcontextprotocol/servers/tree/main/src/github

Please follow the workflow documented in .claude/PLUGIN_GENERATION_WORKFLOW.md

Start by asking me the essential configuration questions, then analyze the repository, generate the manifest, and set up the complete plugin structure.
```

### Step 3: Answer Claude's questions

Claude will ask you about:
- Plugin name
- Description
- Category
- Authentication method
- Configuration fields
- Connection type
- Transport protocol

### Step 4: Claude will:
- ✅ Clone the repository
- ✅ Analyze the MCP server
- ✅ Generate manifest.json
- ✅ Create plugin structure
- ✅ Install dependencies
- ✅ Build the plugin
- ✅ Run type checks

### Step 5: Test the plugin
- Enable it in the Hay dashboard
- Configure the settings
- Test the tools

## Key Information to Gather

Before starting, you should know:

### Essential
- **GitHub URL** of the MCP server
- **Plugin name** (will become `hay-plugin-{name}`)
- **Purpose** (one-sentence description)
- **Authentication method** (OAuth, API Key, JWT, or none)

### Authentication Details

#### For OAuth:
- Authorization URL
- Token URL
- Required scopes
- Whether PKCE is enabled
- Client ID and Client Secret environment variable names

#### For API Key:
- List of required API keys
- Environment variable names for each
- Whether each should be encrypted

#### For JWT:
- Token endpoint
- Required claims

### Configuration
For each setting users need to provide:
- Field name (camelCase)
- Display label
- Description
- Placeholder example
- Is it required?
- Should it be encrypted?
- Environment variable name
- Validation regex (optional)

### Connection
- **Local** or **Remote** MCP server?
- If remote: what's the URL?
- Transport protocol: stdio, sse, websocket, http, or combination?

### Optional
- Marketplace tags
- Should it be featured?
- Custom icon

## File Structure Overview

```
.claude/
├── PLUGIN_GENERATION_WORKFLOW.md    # Complete detailed workflow
├── PLUGIN_GENERATION_PROMPT.md      # AI prompt templates
└── PLUGIN_GENERATION_QUICKSTART.md  # This file

plugins/
├── base/
│   └── plugin-manifest.schema.json  # Schema for validation
└── {plugin-name}/
    ├── mcp/                         # Cloned MCP server (created by workflow)
    ├── src/                         # Plugin source code (created by workflow)
    ├── dist/                        # Compiled plugin (created by workflow)
    ├── manifest.json                # Plugin manifest (created by workflow)
    ├── package.json                 # Plugin dependencies (created by workflow)
    └── tsconfig.json                # TypeScript config (created by workflow)
```

## Common Patterns

### Pattern 1: Remote MCP Server (Stripe-style)
```
Connection: remote
URL: https://api.example.com
Auth: OAuth + API Key
Transport: Not applicable
Entry: ./dist/index.js (thin wrapper)
```

### Pattern 2: Local API Key Auth (Shopify-style)
```
Connection: local
Auth: API Key
Transport: sse|websocket|http
Start: node mcp/index.js
Config: API key + domain/URL
```

### Pattern 3: Local OAuth (Zendesk-style)
```
Connection: local
Auth: oauth2, jwt, apiKey (multiple options)
Transport: sse|websocket|http
Start: node mcp/index.js
Config: Subdomain, email, token OR OAuth
```

### Pattern 4: Simple Local (Hello-World-style)
```
Connection: local
Auth: none
Transport: stdio
Start: node mcp/index.js
Config: Optional settings only
```

## Decision Matrix

Use this to determine the right configuration:

| MCP Server Type | Connection | Auth | Transport | Example |
|----------------|------------|------|-----------|---------|
| Cloud service API | Remote | OAuth/API Key | N/A | Stripe |
| Self-hosted with API | Local | API Key | sse\|ws\|http | Shopify |
| Multi-auth service | Local | Multiple | sse\|ws\|http | Zendesk |
| Simple utility | Local | None | stdio | Hello World |

## Troubleshooting

### Problem: Can't clone the repository
**Solution:** Ensure the URL is correct and the repository is public. If it's in a monorepo, you may need to specify the subdirectory.

### Problem: Tool definitions not found
**Solution:** Look in these locations:
- `server.listTools()` method
- README documentation
- TypeScript/JavaScript source files
- OpenAPI/Swagger specs

### Problem: Build fails
**Solution:**
- Check Node.js version compatibility
- Verify MCP server has valid package.json
- Look for custom build scripts
- Check if TypeScript compilation is needed

### Problem: Authentication unclear
**Solution:**
- Read the MCP server's README
- Check for environment variable examples
- Look at example configurations
- Review the server's authentication middleware

### Problem: Type check fails
**Solution:**
- Ensure all dependencies are installed
- Check that TypeScript config is correct
- Verify manifest.json follows schema
- Review generated types for errors

## Advanced: Batch Generation

To generate multiple plugins at once, create a script:

```bash
#!/bin/bash

REPOS=(
  "https://github.com/example/repo1"
  "https://github.com/example/repo2"
  "https://github.com/example/repo3"
)

for REPO in "${REPOS[@]}"; do
  echo "Generating plugin for $REPO"
  # Use Claude API or paste prompt manually
done
```

## Next Steps After Generation

1. **Review the manifest.json** - Ensure all fields are correct
2. **Test locally** - Enable the plugin and try the tools
3. **Add custom logic** - Extend src/index.ts if needed
4. **Create documentation** - Add a README to the plugin directory
5. **Add to marketplace** - Set featured=true if appropriate
6. **Create UI components** - Add custom settings pages if needed
7. **Write tests** - Add integration tests for the tools

## Reference Plugins

Study these existing plugins for patterns:

- **[stripe](../plugins/stripe/)** - Remote MCP with OAuth + API Key
- **[shopify](../plugins/shopify/)** - Local MCP with API Key auth
- **[zendesk](../plugins/zendesk/)** - Local MCP with multiple auth options
- **[woocommerce](../plugins/woocommerce/)** - Local MCP with WordPress integration
- **[hello-world](../plugins/hello-world/)** - Simple example plugin

## Getting Help

If you encounter issues:

1. Review the full workflow: `PLUGIN_GENERATION_WORKFLOW.md`
2. Check the manifest schema: `plugins/base/plugin-manifest.schema.json`
3. Compare with existing plugins in `plugins/` directory
4. Ask Claude to help debug specific issues

## Best Practices

✅ **DO:**
- Gather all information before starting
- Use descriptive plugin names
- Follow existing naming conventions
- Encrypt sensitive configuration fields
- Provide clear descriptions and labels
- Test thoroughly before deploying
- Document custom functionality

❌ **DON'T:**
- Skip type checking
- Commit secrets to the repository
- Use generic descriptions
- Mix authentication methods unnecessarily
- Forget to validate the manifest
- Leave placeholder values in production
