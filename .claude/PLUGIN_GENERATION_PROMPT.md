# MCP Plugin Generator Prompt

Use this prompt to instruct Claude to generate a Hay plugin from an MCP server repository.

---

## Prompt Template

```
I need you to create a Hay plugin from an existing MCP (Model Context Protocol) server. You will need to:

1. Clone the MCP server repository into the correct location
2. Analyze the MCP server to extract tool definitions
3. Ask me questions to gather necessary configuration details
4. Generate a complete manifest.json file
5. Set up the plugin structure (package.json, tsconfig.json, src/index.ts)
6. Install dependencies and build the plugin
7. Run type checks to ensure everything is correct

**GitHub Repository URL:** {GITHUB_URL}

**Important Context:**
- Plugin directory: /Users/rogerjunior/Documents/code/hay/hay-core/plugins
- Schema location: /Users/rogerjunior/Documents/code/hay/hay-core/plugins/base/plugin-manifest.schema.json
- Workflow documentation: /Users/rogerjunior/Documents/code/hay/hay-core/.claude/PLUGIN_GENERATION_WORKFLOW.md
- Reference plugins: shopify, stripe, zendesk, woocommerce, hello-world

**Please follow these steps:**

1. First, read the workflow documentation at .claude/PLUGIN_GENERATION_WORKFLOW.md
2. Ask me all the essential questions from the "Interactive Questions" section
3. Clone the repository into /plugins/{plugin-name}/mcp/
4. Analyze the MCP server structure to extract tool definitions
5. Generate the manifest.json file based on my answers and the schema
6. Set up the plugin structure (package.json, tsconfig.json, src/index.ts)
7. Run npm install in both the plugin root and mcp directory
8. Build the plugin with npm run build
9. Run typecheck to verify everything works

**Questions you should ask me:**
- What should we name this plugin?
- What is the primary purpose/description?
- What category does it belong to?
- What authentication method(s) does it use?
- What configuration fields do users need?
- Does it run locally or is it a remote server?
- What transport protocol does it use?

Let's start! Ask me the questions one by one, and after I answer them all, proceed with the implementation.
```

---

## Quick Start Example

Here's a real example you can use:

```
I need you to create a Hay plugin from the MCP server at:
https://github.com/modelcontextprotocol/servers/tree/main/src/github

Please follow the workflow documented in .claude/PLUGIN_GENERATION_WORKFLOW.md

Start by asking me the essential configuration questions, then analyze the repository, generate the manifest, and set up the complete plugin structure.
```

---

## Alternative: Non-Interactive Mode

If you want to provide all information upfront:

```
Create a Hay plugin from the MCP server with the following details:

**Repository:** {GITHUB_URL}
**Plugin Name:** {name}
**Description:** {description}
**Category:** {integration|chat|analytics|automation|utility}
**Plugin Types:** {mcp-connector|retriever|playbook|channel|workflow|analytics}
**Authentication:** {oauth2|apiKey|jwt|none}
**Connection Type:** {local|remote}
**Transport:** {stdio|sse|websocket|http}

{If OAuth:}
**OAuth Config:**
- Authorization URL: {url}
- Token URL: {url}
- Scopes: {scope1, scope2}
- PKCE: {true|false}
- Client ID Env Var: {ENV_NAME}
- Client Secret Env Var: {ENV_NAME}

{If API Key:}
**Configuration Fields:**
- {fieldName}: {description} (env: {ENV_VAR}, encrypted: {yes/no}, required: {yes/no})

**Marketplace:**
- Featured: {yes|no}
- Tags: {tag1, tag2, tag3}

Please read the workflow at .claude/PLUGIN_GENERATION_WORKFLOW.md and generate the complete plugin following all steps.
```

---

## What the AI Will Do

When you provide this prompt, Claude will:

1. ✅ Read the workflow documentation
2. ✅ Ask you clarifying questions (if needed)
3. ✅ Clone the MCP server repository
4. ✅ Analyze the code to extract tool definitions
5. ✅ Generate a complete manifest.json file
6. ✅ Create package.json, tsconfig.json, and src/index.ts
7. ✅ Install all dependencies
8. ✅ Build the plugin
9. ✅ Run type checks
10. ✅ Verify the plugin is ready to use

---

## Expected Outputs

After completion, you should have:

```
plugins/{plugin-name}/
├── mcp/                    # Cloned MCP server
│   ├── index.js
│   ├── package.json
│   └── node_modules/
├── src/
│   └── index.ts           # Plugin entry point
├── dist/
│   └── index.js           # Compiled plugin
├── manifest.json          # Complete plugin manifest
├── package.json           # Plugin dependencies
├── tsconfig.json          # TypeScript config
└── node_modules/          # Plugin dependencies
```

---

## Validation Checklist

After the AI completes the workflow, verify:

- [ ] manifest.json validates against the schema
- [ ] All tools from the MCP server are listed
- [ ] Authentication configuration is complete
- [ ] Configuration schema matches environment variables
- [ ] Plugin compiles without errors
- [ ] Type check passes
- [ ] Dependencies are installed

---

## Troubleshooting

### If the repository structure is unexpected:
"The MCP server is actually located in {subdirectory}. Please adjust the clone path accordingly."

### If tool extraction fails:
"I'll provide the tool definitions manually. Here are the tools: {tool list}"

### If authentication is unclear:
"Let me check the MCP server documentation. The auth method is {method} with these requirements: {details}"

### If build fails:
"The MCP server has a different build process. Use these commands instead: {commands}"
