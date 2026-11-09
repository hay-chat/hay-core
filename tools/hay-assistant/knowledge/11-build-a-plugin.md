---
title: "Hay.chat: building a plugin"
type: guide
verified: 2026-11-09
sources:
  - hay-core packages/plugin-sdk/README.md
  - hay-core .claude/skills/build-plugin/SKILL.md (canonical authoring guide)
  - hay-core CLAUDE.md (plugin structure and types)
todo:
  - TODO(Roger) Public plugin docs live in the docs submodule (docs/technical/plugins); hay.chat/docs/technical/plugins/getting-started/ is referenced from llms.txt. Confirm it is current after the docs audit.
---
# Building a Hay.chat plugin

Plugins are how Hay.chat connects to other services. They are built on the **@hay/plugin-sdk** and the Model Context Protocol (MCP). The core product never hardcodes a plugin: plugins are loaded dynamically from the `plugins/` directory of the open codebase (github.com/hay-chat/hay-core).

## What a plugin is
A folder with a `package.json` that has a `hay-plugin` block (display name, category, capabilities) and `src/index.ts` whose default export is `defineHayPlugin(...)`. The plugin id is the npm package name (`hay-plugin-<name>`; channels are `hay-channel-<name>-<provider>`). A plugin runs as a separate worker per organization.

In `onInitialize` you declare configuration fields (for example an API key), authentication (API key or OAuth2) and optionally HTTP routes and UI. In `onStart` you start the MCP server or pollers. MCP tools are the actions the agent can use in playbooks (typed with @).

## Plugin types
Channel (messaging), MCP connector, document importer/retriever, playbook, workflow, analytics.

## Design advice
Write the support playbooks first ("cancel my order", "book a room"). Each step that touches the platform becomes one tool, however many API calls it needs. Do not mirror the whole API one to one. Mark each tool read or write so risky actions can wait for approval.

## Where to start
- The SDK README in `packages/plugin-sdk` and existing plugins in `plugins/core/` (Shopify, WooCommerce, Cal.com and others) as examples.
- The plugin documentation at hay.chat/docs/technical/plugins/getting-started/ .
- To have a plugin built or listed, or for a service you want added, suggest it at hay.chat/suggest-integration/ or offer a call with the founders.

Plugins on the hosted service are reviewed by Hay; self-hosters can run their own. Do not promise a marketplace listing date or a revenue share (not published).

Sources: github.com/hay-chat/hay-core packages/plugin-sdk and plugins/core.
