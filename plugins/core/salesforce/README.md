# Salesforce Plugin

Connect a Salesforce org so the agent can **read and update Contacts, Cases, and any other
sObject** (Accounts, Leads, Opportunities, custom objects) — keeping CRM data in sync with
automated conversations (HAY-110).

It spawns a local Node MCP server (`./mcp`) that calls the Salesforce REST API directly.

## Authentication — OAuth 2.0 Client Credentials Flow

This plugin authenticates server-to-server via a **Connected App** using the Client Credentials
Flow (no interactive login). In Salesforce:

1. **Setup → App Manager → New Connected App** (or **New External Client App**).
2. Enable **OAuth Settings**. Add the scopes you need (at least `api`; `refresh_token`/`offline_access`
   are not required for client credentials).
3. Enable **Client Credentials Flow** and assign a **Run-As user** (its profile/permissions
   determine what the agent can see and change — scope it to the CRM objects you want synced).
4. After saving, open **Manage Consumer Details** to copy the **Consumer Key** and **Consumer Secret**.

Then configure the plugin with:

| Field               | Where it comes from                                                          |
| ------------------- | ---------------------------------------------------------------------------- |
| **Instance URL**    | Your My Domain URL, e.g. `https://your-domain.my.salesforce.com`             |
| **Consumer Key**    | Connected App → Manage Consumer Details → Consumer Key                       |
| **Consumer Secret** | Connected App → Manage Consumer Details → Consumer Secret (stored encrypted) |

The MCP server exchanges these for an access token at startup and transparently re-authenticates
when the token expires (client-credentials tokens have no refresh token).

## Tools

| Tool               | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `soql_query`       | Read records with a SOQL query (find Contacts/Cases by any field).   |
| `query_more`       | Page through a large query result.                                   |
| `list_sobjects`    | List the org's objects (Contact, Case, Account, …).                  |
| `describe_sobject` | Inspect an object's fields, types, required-on-create and picklists. |
| `get_record`       | Get one record by object type + id.                                  |
| `create_record`    | Create a record (e.g. a new Case or Contact).                        |
| `update_record`    | Update fields on an existing record (e.g. close a Case).             |

Reads go through SOQL; writes go through the record tools. Deletes are intentionally not exposed.

## Build

`scripts/build-plugins.sh` builds every core plugin: it installs the plugin-root deps, installs the
bundled `mcp/` server's runtime deps (`@modelcontextprotocol/sdk`, `zod`) when `mcp/node_modules` is
absent, then runs `npm run build`. `node_modules` and `dist/` are gitignored — nothing is vendored.

To build just this plugin locally:

```bash
# from repo root — builds the entry against the SDK file: link
npm install --workspace=plugins/core/salesforce
npm run build  --workspace=plugins/core/salesforce

# the mcp/ server is plain runtime JS, outside the workspace — install its deps
cd plugins/core/salesforce/mcp && npm install
```

## API version

Salesforce REST/SOQL `v60.0` (Spring '24). Bump `API_VERSION` in `mcp/lib/client.js` deliberately.
