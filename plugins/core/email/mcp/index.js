#!/usr/bin/env node

/**
 * Email Plugin MCP Server
 *
 * This MCP server provides email sending capabilities using the platform's SMTP service.
 *
 * ARCHITECTURE:
 * Uses the Plugin API with HTTP callbacks to access the platform's email service.
 * The plugin runs in a separate process and communicates via secure HTTP endpoints.
 *
 * TODO: [PLUGIN-API] Add rate limiting per plugin instance
 * TODO: [PLUGIN-API] Add email quota tracking per organization
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPluginAPIClient } from "../../../../server/dist/services/plugin-api/plugin-api-client.js";

// Read configuration from environment variables
// These are injected by the platform when spawning the plugin process
const EMAIL_RECIPIENTS = process.env.EMAIL_RECIPIENTS || "";
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || "";
const PLUGIN_ID = process.env.PLUGIN_ID || "email";

// Validate required configuration
if (!EMAIL_RECIPIENTS) {
  console.error("[Email Plugin] ERROR: EMAIL_RECIPIENTS environment variable is required");
  process.exit(1);
}

if (!ORGANIZATION_ID) {
  console.error("[Email Plugin] ERROR: ORGANIZATION_ID environment variable is required");
  process.exit(1);
}

// Initialize Plugin API client
let pluginAPI;
try {
  pluginAPI = createPluginAPIClient();
  console.log(`[Email Plugin] Plugin API client initialized for org ${ORGANIZATION_ID}`);
} catch (error) {
  console.error(`[Email Plugin] Failed to initialize Plugin API client: ${error.message}`);
  console.error("[Email Plugin] Make sure PLUGIN_API_URL, PLUGIN_ID, ORGANIZATION_ID, and PLUGIN_API_TOKEN are set");
  process.exit(1);
}

/**
 * Parse and validate recipients from config
 */
function parseRecipients(recipientsString) {
  const recipients = recipientsString
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  // Validate email format
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const invalidEmails = recipients.filter((email) => !emailRegex.test(email));

  if (invalidEmails.length > 0) {
    throw new Error(`Invalid email addresses in config: ${invalidEmails.join(", ")}`);
  }

  if (recipients.length === 0) {
    throw new Error("No valid recipients configured");
  }

  return recipients;
}

// Parse recipients on startup
let recipients;
try {
  recipients = parseRecipients(EMAIL_RECIPIENTS);
  console.log(`[Email Plugin] Initialized for org ${ORGANIZATION_ID} with ${recipients.length} recipient(s)`);
} catch (error) {
  console.error(`[Email Plugin] Failed to parse recipients: ${error.message}`);
  process.exit(1);
}

/**
 * Send email using platform's email service via Plugin API
 *
 * TODO: [PLUGIN-API] Add proper error handling and retry logic
 * TODO: [PLUGIN-API] Log email sends for auditing
 */
async function sendEmail(subject, body) {
  try {
    const result = await pluginAPI.sendEmail({
      to: recipients,
      subject: subject,
      text: body,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to send email");
    }

    return {
      success: true,
      message: `Email sent successfully to ${recipients.length} recipient(s): ${recipients.join(", ")}`,
      messageId: result.data?.messageId,
      recipients: recipients,
    };
  } catch (error) {
    console.error(`[Email Plugin] Failed to send email:`, error);
    throw error;
  }
}

// Initialize MCP server
const server = new McpServer({
  name: "email",
  version: "1.0.0",
  description: "Send emails using platform's SMTP service",
});

// Register healthcheck tool
server.tool(
  "healthcheck",
  {},
  async () => {
    try {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "healthy",
                plugin: "email",
                version: "1.0.0",
                organizationId: ORGANIZATION_ID,
                recipients: recipients,
                recipientCount: recipients.length,
                smtpConfigured: true, // We assume SMTP is configured if the plugin is running
                message: "Email plugin is running and ready to send emails",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "unhealthy",
                error: error instanceof Error ? error.message : "Unknown error",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register send-email tool
server.tool(
  "send-email",
  {
    subject: z.string().min(1, "Subject is required and cannot be empty"),
    body: z.string().min(1, "Body is required and cannot be empty"),
  },
  async (args) => {
    try {
      const result = await sendEmail(args.subject, args.body);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : "Failed to send email",
                recipients: recipients,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the MCP server
const transport = new StdioServerTransport();
server
  .connect(transport)
  .then(() => {
    console.log("[Email Plugin] MCP server started successfully");
  })
  .catch((error) => {
    console.error("[Email Plugin] Failed to start MCP server:", error);
    process.exit(1);
  });
