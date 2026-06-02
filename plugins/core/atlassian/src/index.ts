/**
 * Atlassian Plugin
 *
 * One Atlassian connection that powers two things:
 *   - Confluence document import (via the tRPC router declared in router.ts;
 *     consumed by the core document-source sync engine)
 *   - Jira tools exposed to the chat agent over MCP (this file)
 *
 * The same credentials (Basic API token OR OAuth 3LO) authorize both.
 */

import { defineHayPlugin } from "@hay/plugin-sdk";
import { JiraClient } from "./jira-client";
import type { AuthConfig } from "./confluence-client";

interface MCPTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

function authConfigFromCtx(ctx: {
  config: {
    getOptional: <T>(key: string) => T | undefined;
  };
  auth?: { get: () => unknown };
}): AuthConfig | null {
  const authMode = ctx.config.getOptional<string>("authMode") ?? "basic";
  const siteUrl = ctx.config.getOptional<string>("siteUrl") ?? "";

  if (authMode === "oauth") {
    const authState = ctx.auth?.get() as
      | { credentials?: { accessToken?: string; cloudId?: string } }
      | undefined;
    const accessToken = authState?.credentials?.accessToken;
    const cloudId = authState?.credentials?.cloudId ?? ctx.config.getOptional<string>("cloudId");
    if (!accessToken || !cloudId) return null;
    return { mode: "oauth", accessToken, cloudId };
  }

  const email = ctx.config.getOptional<string>("email") ?? "";
  const apiToken = ctx.config.getOptional<string>("apiToken") ?? "";
  if (!email || !apiToken || !siteUrl) return null;
  return { mode: "basic", email, apiToken, siteUrl };
}

export default defineHayPlugin((globalCtx) => ({
  name: "Atlassian",

  /**
   * Global initialization - register config and auth methods
   */
  onInitialize(ctx) {
    globalCtx.logger.info("Initializing Atlassian plugin");

    // OAuth app credentials (used only when authMode='oauth').
    ctx.register.config({
      clientId: {
        type: "string",
        label: "Atlassian OAuth Client ID",
        description: "OAuth client ID — only needed when authMode='oauth'",
        required: false,
        encrypted: false,
        env: "ATLASSIAN_CLIENT_ID",
      },
      clientSecret: {
        type: "string",
        label: "Atlassian OAuth Client Secret",
        description: "OAuth client secret — only needed when authMode='oauth'",
        required: false,
        encrypted: true,
        env: "ATLASSIAN_CLIENT_SECRET",
      },
    });

    // OAuth2 (3LO). Scopes cover BOTH Confluence (for document import) and
    // Jira (for the MCP tools below) — one connection serves both halves.
    ctx.register.auth.oauth2({
      id: "atlassian-oauth",
      label: "Atlassian OAuth",
      authorizationUrl: "https://auth.atlassian.com/authorize",
      tokenUrl: "https://auth.atlassian.com/oauth/token",
      scopes: [
        "read:confluence-content.all",
        "read:confluence-space.summary",
        "read:content-details:confluence",
        "read:content.metadata:confluence",
        "read:jira-work",
        "read:jira-user",
        "write:jira-work",
        "offline_access",
      ],
      clientId: ctx.config.field("clientId"),
      clientSecret: ctx.config.field("clientSecret"),
    });

    globalCtx.logger.info("Atlassian plugin registered (Confluence import + Jira MCP)");
  },

  async onValidateAuth(ctx) {
    ctx.logger.info("Validating Atlassian auth credentials");
    const authState = ctx.auth.get();
    if (!authState) {
      throw new Error("No authentication configured");
    }
    return true;
  },

  async onStart(ctx) {
    ctx.logger.info("Starting Atlassian plugin for org", { orgId: ctx.org.id });

    // Register the in-process MCP server that exposes Jira tools to the agent.
    await ctx.mcp.startLocal("atlassian-jira-mcp", async (mcpCtx) => {
      const getClient = (): JiraClient => {
        const auth = authConfigFromCtx(ctx);
        if (!auth) {
          throw new Error(
            "Atlassian plugin is not fully configured (missing siteUrl/email/apiToken or OAuth credentials).",
          );
        }
        return new JiraClient(auth);
      };

      return {
        async listTools(): Promise<MCPTool[]> {
          return [
            {
              name: "jira_list_projects",
              description:
                "List Jira projects visible to the connected Atlassian account. Returns project key, name, id, and type. Use this to discover which projects can be queried.",
              input_schema: {
                type: "object",
                properties: {
                  limit: {
                    type: "number",
                    description: "Maximum number of projects to return (default 50).",
                  },
                },
                required: [],
              },
            },
            {
              name: "jira_search_issues",
              description:
                "Search Jira issues using JQL (Jira Query Language). Returns up to maxResults issues with summary, status, type, priority, assignee, and project. Examples: " +
                "'project = ENG AND status = \"In Progress\"', " +
                "'assignee = currentUser() AND resolved is EMPTY', " +
                "'created >= -7d'.",
              input_schema: {
                type: "object",
                properties: {
                  jql: {
                    type: "string",
                    description:
                      "JQL query string. See https://www.atlassian.com/software/jira/guides/jql/overview for syntax.",
                  },
                  maxResults: {
                    type: "number",
                    description: "Maximum number of results to return (default 25, max 100).",
                  },
                },
                required: ["jql"],
              },
            },
            {
              name: "jira_get_issue",
              description:
                "Fetch the full details of a single Jira issue by its key (e.g. 'ENG-123') or numeric id. Returns all standard fields including the description body in ADF format.",
              input_schema: {
                type: "object",
                properties: {
                  idOrKey: {
                    type: "string",
                    description: "Issue key (e.g. 'ENG-123') or numeric id.",
                  },
                },
                required: ["idOrKey"],
              },
            },
            {
              name: "jira_get_my_issues",
              description:
                "Convenience helper that returns the connected user's open Jira issues across all projects, sorted by most recently updated. Equivalent to searching with JQL 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'.",
              input_schema: {
                type: "object",
                properties: {
                  maxResults: {
                    type: "number",
                    description: "Maximum number of issues to return (default 25).",
                  },
                },
                required: [],
              },
            },
            {
              name: "jira_create_issue",
              description:
                "Create a new Jira issue. At minimum you need a projectKey (e.g. 'ENG' or 'HAY') and a summary. Use jira_list_projects first if you don't know which projects exist. The description is plain text; it will be wrapped in Atlassian Document Format automatically.",
              input_schema: {
                type: "object",
                properties: {
                  projectKey: {
                    type: "string",
                    description:
                      "Jira project key, e.g. 'ENG' or 'HAY'. Find available keys with jira_list_projects.",
                  },
                  summary: {
                    type: "string",
                    description: "Short title for the issue (one line).",
                  },
                  issueType: {
                    type: "string",
                    description:
                      "Issue type name, e.g. 'Task', 'Bug', 'Story', 'Epic'. Defaults to 'Task' if omitted.",
                  },
                  description: {
                    type: "string",
                    description: "Longer description / body of the issue, in plain text. Optional.",
                  },
                  priority: {
                    type: "string",
                    description:
                      "Priority name, e.g. 'High', 'Medium', 'Low'. Only set if the project actually uses priorities.",
                  },
                  labels: {
                    type: "array",
                    items: { type: "string" },
                    description: "Labels to attach to the issue.",
                  },
                  assigneeAccountId: {
                    type: "string",
                    description:
                      "Atlassian accountId of the assignee. Omit to leave unassigned. (Display names will NOT work — must be accountId.)",
                  },
                  duedate: {
                    type: "string",
                    description: "Due date in YYYY-MM-DD format. Optional.",
                  },
                },
                required: ["projectKey", "summary"],
              },
            },
          ];
        },

        async callTool(toolName: string, args: Record<string, any>): Promise<any> {
          mcpCtx.logger.info(`Atlassian/Jira tool call: ${toolName}`, { args });
          const client = getClient();

          if (toolName === "jira_list_projects") {
            const result = await client.listProjects({ limit: args.limit ?? 50 });
            return {
              total: result.total,
              projects: result.values.map((p) => ({
                id: p.id,
                key: p.key,
                name: p.name,
                type: p.projectTypeKey,
              })),
            };
          }

          if (toolName === "jira_search_issues") {
            if (!args.jql || typeof args.jql !== "string") {
              throw new Error("jql is required and must be a string");
            }
            const result = await client.searchIssues({
              jql: args.jql,
              maxResults: Math.min(args.maxResults ?? 25, 100),
            });
            return {
              total: result.total,
              issues: result.issues.map((iss) => ({
                key: iss.key,
                summary: iss.fields.summary,
                status: iss.fields.status?.name,
                statusCategory: iss.fields.status?.statusCategory?.key,
                type: iss.fields.issuetype?.name,
                priority: iss.fields.priority?.name,
                assignee: iss.fields.assignee?.displayName,
                reporter: iss.fields.reporter?.displayName,
                project: iss.fields.project?.key,
                created: iss.fields.created,
                updated: iss.fields.updated,
                duedate: iss.fields.duedate ?? null,
                labels: iss.fields.labels ?? [],
              })),
            };
          }

          if (toolName === "jira_get_issue") {
            if (!args.idOrKey || typeof args.idOrKey !== "string") {
              throw new Error("idOrKey is required and must be a string");
            }
            const issue = await client.getIssue(args.idOrKey);
            return {
              key: issue.key,
              id: issue.id,
              summary: issue.fields.summary,
              status: issue.fields.status?.name,
              type: issue.fields.issuetype?.name,
              priority: issue.fields.priority?.name,
              assignee: issue.fields.assignee?.displayName,
              reporter: issue.fields.reporter?.displayName,
              project: issue.fields.project?.key,
              created: issue.fields.created,
              updated: issue.fields.updated,
              duedate: issue.fields.duedate ?? null,
              labels: issue.fields.labels ?? [],
              description: issue.fields.description ?? null,
            };
          }

          if (toolName === "jira_get_my_issues") {
            const result = await client.searchIssues({
              jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
              maxResults: Math.min(args.maxResults ?? 25, 100),
            });
            return {
              total: result.total,
              issues: result.issues.map((iss) => ({
                key: iss.key,
                summary: iss.fields.summary,
                status: iss.fields.status?.name,
                type: iss.fields.issuetype?.name,
                priority: iss.fields.priority?.name,
                project: iss.fields.project?.key,
                updated: iss.fields.updated,
                duedate: iss.fields.duedate ?? null,
              })),
            };
          }

          if (toolName === "jira_create_issue") {
            if (!args.projectKey || typeof args.projectKey !== "string") {
              throw new Error("projectKey is required and must be a string");
            }
            if (!args.summary || typeof args.summary !== "string") {
              throw new Error("summary is required and must be a string");
            }
            const created = await client.createIssue({
              projectKey: args.projectKey,
              summary: args.summary,
              issueType: args.issueType,
              description: args.description,
              priority: args.priority,
              labels: Array.isArray(args.labels) ? args.labels : undefined,
              assigneeAccountId: args.assigneeAccountId,
              duedate: args.duedate,
            });
            return {
              key: created.key,
              id: created.id,
              url: `${ctx.config.getOptional<string>("siteUrl")?.replace(/\/+$/, "")}/browse/${created.key}`,
            };
          }

          throw new Error(`Unknown tool: ${toolName}`);
        },
      };
    });

    ctx.logger.info("Atlassian Jira MCP server registered (5 tools)");
  },

  async onConfigUpdate(ctx) {
    ctx.logger.info("Atlassian plugin config updated");
  },

  async onDisable(ctx) {
    ctx.logger.info("Atlassian plugin disabled for org", { orgId: ctx.org.id });
  },

  async onEnable(ctx) {
    ctx.logger.info("Atlassian plugin enabled");
  },
}));
