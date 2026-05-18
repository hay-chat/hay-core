#!/usr/bin/env node
/**
 * Local Node MCP server for Klaviyo.
 *
 * Port of the public klaviyo-mcp-server Python package. Each tool here calls
 * the Klaviyo REST API directly (https://a.klaviyo.com/api/...) using the
 * PRIVATE_API_KEY env var.
 *
 * Notes on schemas:
 *  - Where the Python package uses very rich pydantic types (FieldsParam,
 *    FilterParam, etc.), we accept the corresponding Klaviyo query params
 *    as raw strings/arrays. The tool descriptions point the agent at
 *    Klaviyo's filter and sparse-fieldsets docs.
 *  - For create/update tools that take large nested bodies, we accept the
 *    JSON:API `attributes` object as a passthrough so the agent constructs
 *    it per Klaviyo's API reference rather than us mirroring every nested
 *    field as a separate parameter.
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const KLAVIYO_BASE_URL = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

const PRIVATE_API_KEY = process.env.PRIVATE_API_KEY;
if (!PRIVATE_API_KEY) {
  console.error("ERROR: PRIVATE_API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Call the Klaviyo REST API.
 *
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE).
 * @param {string} path - Path beginning with "/", relative to KLAVIYO_BASE_URL.
 * @param {object} [options]
 * @param {object} [options.query] - Query params; values may be strings, numbers,
 *   booleans, or arrays (arrays become comma-separated strings).
 * @param {object} [options.body] - Optional JSON:API request body.
 * @returns {Promise<any>} Parsed JSON response body (or `null` for 204).
 */
async function klaviyoApi(method, path, { query, body } = {}) {
  const url = new URL(KLAVIYO_BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: `Klaviyo-API-Key ${PRIVATE_API_KEY}`,
    Accept: "application/vnd.api+json",
    revision: KLAVIYO_REVISION,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/vnd.api+json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Klaviyo API ${method} ${path} failed: ${response.status} ${response.statusText} ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Strip JSON:API noise that's irrelevant to the agent.
 * Mirrors the Python `clean_result` helper.
 */
function cleanResult(data) {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const item of data) cleanResult(item);
    return;
  }
  if (typeof data === "object") {
    delete data.relationships;
    delete data.links;
  }
}

/** Build a JSON tool response. */
function ok(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/** Build a JSON tool response wrapping an error. */
function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "klaviyo-mcp-server",
  version: "1.0.0",
});

// Common schema fragments reused across many tools.
const fieldsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "Sparse fieldset: list of attributes to return for this resource. See https://developers.klaviyo.com/en/reference/api_overview#sparse-fieldsets",
  );

const filterSchema = z
  .string()
  .optional()
  .describe(
    'Klaviyo filter string, e.g. `equals(name,"My List")` or `greater-than(created,2024-01-01T00:00:00Z),equals(archived,false)`. See https://developers.klaviyo.com/en/reference/api_overview#filtering',
  );

const sortSchema = z
  .string()
  .optional()
  .describe(
    "Sort field. Prefix with `-` for descending (e.g. `-created`). See each endpoint's docs for allowed values.",
  );

const pageCursorSchema = z
  .string()
  .optional()
  .describe("Cursor for pagination. Pass the `links.next` cursor from a prior response.");

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

server.tool(
  "get_account_details",
  `Get the details of the account. Getting information about the catalog may also be useful (use the get_catalog_items tool for this).

You can view and edit your account details flow in the Klaviyo UI at https://www.klaviyo.com/settings/account`,
  {},
  async () => {
    try {
      const response = await klaviyoApi("GET", "/accounts/");
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

server.tool(
  "get_campaigns",
  `Returns some or all campaigns based on filters. To get performance data, use get_campaign_report.

You can view and edit a campaign in the Klaviyo UI at https://www.klaviyo.com/campaign/{CAMPAIGN_ID}/wizard`,
  {
    channel: z
      .enum(["email", "sms", "mobile_push"])
      .describe(
        "Which types of campaigns to return. To get all types, call this tool once per channel.",
      ),
    fields: fieldsSchema,
    filter: filterSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ channel, fields, filter, pageCursor }) => {
    try {
      // `messages.channel` is required as a filter on this endpoint.
      const channelFilter = `equals(messages.channel,"${channel}")`;
      const combinedFilter = filter ? `${filter},${channelFilter}` : channelFilter;
      const response = await klaviyoApi("GET", "/campaigns/", {
        query: {
          "fields[campaign]": fields,
          filter: combinedFilter,
          include: "campaign-messages",
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_campaign",
  `Returns a specific campaign based on a required id.

You can view and edit a campaign in the Klaviyo UI at https://www.klaviyo.com/campaign/{CAMPAIGN_ID}/wizard`,
  {
    campaignId: z.string().describe("The campaign ID."),
  },
  async ({ campaignId }) => {
    try {
      const response = await klaviyoApi("GET", `/campaigns/${campaignId}/`, {
        query: { include: "campaign-messages" },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_campaign",
  `Creates a new draft campaign.

For email campaigns, this can be used with the create_email_template tool for template creation and then assign_template_to_campaign_message to assign the template to the email campaign.

You can view and edit a campaign in the Klaviyo UI at https://www.klaviyo.com/campaign/{CAMPAIGN_ID}/wizard`,
  {
    name: z.string().describe("The name of the campaign."),
    campaignMessage: z
      .record(z.any())
      .describe(
        "The campaign message `definition` object as documented at https://developers.klaviyo.com/en/reference/create_campaign. Includes `content`, `render_options`, etc.",
      ),
    includedAudiences: z
      .array(z.string())
      .describe(
        "List IDs or segment IDs to send the campaign to. Use get_lists and get_segments to discover IDs.",
      ),
    excludedAudiences: z
      .array(z.string())
      .optional()
      .describe("List or segment IDs to exclude from the send."),
    useSmartSending: z
      .boolean()
      .optional()
      .describe("Skip profiles recently sent a message. Defaults to true."),
    trackingOptions: z
      .record(z.any())
      .optional()
      .describe("`tracking_options` attribute per Klaviyo docs."),
    sendStrategy: z
      .record(z.any())
      .optional()
      .describe("`send_strategy` attribute per Klaviyo docs. Defaults to Immediate."),
  },
  async (input) => {
    try {
      const attributes = {
        name: input.name,
        audiences: {
          included: input.includedAudiences,
          excluded: input.excludedAudiences || [],
        },
        send_options: {
          use_smart_sending: input.useSmartSending ?? true,
        },
        "campaign-messages": {
          data: [
            {
              type: "campaign-message",
              attributes: { definition: input.campaignMessage },
            },
          ],
        },
      };
      if (input.sendStrategy) attributes.send_strategy = input.sendStrategy;
      if (input.trackingOptions) attributes.tracking_options = input.trackingOptions;

      const response = await klaviyoApi("POST", "/campaigns/", {
        body: { data: { type: "campaign", attributes } },
      });
      // The campaign-messages relationship is intentionally preserved so the
      // agent can pass its id to assign_template_to_campaign_message.
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "assign_template_to_campaign_message",
  `Assigns an email template to a campaign message.
This should be used after creating a template with the create_email_template tool and creating an email campaign.`,
  {
    campaignMessageId: z
      .string()
      .describe("The ID of the email campaign message to assign the template to."),
    emailTemplateId: z.string().describe("The ID of the email template to assign."),
  },
  async ({ campaignMessageId, emailTemplateId }) => {
    try {
      const response = await klaviyoApi(
        "POST",
        `/campaign-messages/${campaignMessageId}/relationships/template/`,
        {
          body: {
            data: {
              type: "campaign-message",
              id: campaignMessageId,
              relationships: {
                template: { data: { type: "template", id: emailTemplateId } },
              },
            },
          },
        },
      );
      cleanResult(response?.data);
      return ok(response ?? { status: "Success" });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

server.tool(
  "get_catalog_items",
  `Get all catalog items in an account. (Also known as products)`,
  {
    fields: fieldsSchema,
    filter: filterSchema,
    sort: sortSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ fields, filter, sort, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/catalog-items/", {
        query: {
          "fields[catalog-item]": fields,
          filter,
          sort,
          include: "variants",
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

server.tool(
  "get_events",
  `Get events for a given filter such as a profile ID or metric ID.`,
  {
    fields: fieldsSchema,
    filter: filterSchema,
    sort: sortSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ fields, filter, sort, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/events/", {
        query: {
          "fields[event]": fields,
          "fields[metric]": ["name", "created", "updated", "integration"],
          "fields[profile]": ["email", "phone_number", "external_id", "first_name", "last_name"],
          filter,
          sort,
          include: ["metric", "profile", "attributions"],
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.included);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_event",
  `Create an event.

At a minimum, profile and metric objects should include at least one profile identifier (e.g., id, email, or phone_number) and the metric name, respectively.

Returns "Success" if successful. Raises an error if unsuccessful.`,
  {
    event: z
      .record(z.any())
      .describe(
        "Event attributes. Typically includes `properties`, `time`, `value`, etc. See https://developers.klaviyo.com/en/reference/create_event.",
      ),
    profile: z
      .record(z.any())
      .describe(
        "Profile reference. Must include at least one identifier (id, email, or phone_number).",
      ),
    metric: z.record(z.any()).describe("Metric reference. Must include `name`."),
  },
  async ({ event, profile, metric }) => {
    try {
      await klaviyoApi("POST", "/events/", {
        body: {
          data: {
            type: "event",
            attributes: {
              ...event,
              metric: { data: metric },
              profile: { data: profile },
            },
          },
        },
      });
      return ok({ status: "Success" });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

server.tool(
  "get_flows",
  `Returns some or all flows based on filters.

You can view and edit a flow in the Klaviyo UI at https://www.klaviyo.com/flow/{FLOW_ID}/edit.`,
  {
    fields: fieldsSchema,
    filter: filterSchema,
    pageCursor: pageCursorSchema,
    pageSize: z.number().int().positive().optional(),
  },
  async ({ fields, filter, pageCursor, pageSize }) => {
    try {
      const response = await klaviyoApi("GET", "/flows/", {
        query: {
          "fields[flow]": fields,
          filter,
          "page[cursor]": pageCursor,
          "page[size]": pageSize,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_flow",
  `Returns a flow by ID.

You can view and edit a flow in the Klaviyo UI at https://www.klaviyo.com/flow/{FLOW_ID}/edit.`,
  {
    flowId: z.string().describe("The flow ID."),
  },
  async ({ flowId }) => {
    try {
      const response = await klaviyoApi("GET", `/flows/${flowId}/`);
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

server.tool(
  "upload_image_from_file",
  `Upload an image from a file. If you want to upload an image from an existing URL or a data URI, use the
upload_image_from_url tool instead.`,
  {
    filePath: z.string().describe("The absolute file path of the image file to upload."),
    name: z
      .string()
      .optional()
      .describe("A name for the image. Defaults to the filename if omitted."),
  },
  async ({ filePath, name }) => {
    try {
      const fs = require("fs");
      const path = require("path");
      const buffer = fs.readFileSync(filePath);
      const filename = name || path.basename(filePath);
      const mime = mimeFromExtension(filename);

      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mime }), filename);
      if (name) form.append("name", name);

      // multipart upload uses a different endpoint and content-type
      const response = await fetch(`${KLAVIYO_BASE_URL}/image-upload/`, {
        method: "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${PRIVATE_API_KEY}`,
          revision: KLAVIYO_REVISION,
          Accept: "application/vnd.api+json",
        },
        body: form,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Klaviyo image upload failed: ${response.status} ${response.statusText} ${text}`,
        );
      }
      const json = text ? JSON.parse(text) : null;
      cleanResult(json?.data);
      return ok(json);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "upload_image_from_url",
  `Upload an image from a URL or data URI. If you want to upload an image from a file, use the
upload_image_from_file tool instead.`,
  {
    imageUrl: z.string().describe("The URL or data URI of the image to upload."),
    name: z
      .string()
      .optional()
      .describe("A name for the image. Defaults to the filename if omitted."),
  },
  async ({ imageUrl, name }) => {
    try {
      const response = await klaviyoApi("POST", "/images/", {
        body: {
          data: {
            type: "image",
            attributes: { import_from_url: imageUrl, name: name ?? null },
          },
        },
      });
      cleanResult(response?.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

function mimeFromExtension(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

server.tool(
  "get_lists",
  `Get all lists in an account.

To filter by tag, do not use the 'filters' parameter. Instead, call this and look for the 'tags' property.

You can view and edit a list in the Klaviyo UI at https://www.klaviyo.com/lists/{LIST_ID}`,
  {
    fields: fieldsSchema,
    filter: filterSchema,
    sort: sortSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ fields, filter, sort, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/lists/", {
        query: {
          "fields[list]": fields,
          filter,
          sort,
          include: "tags",
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_list",
  `Get a list with the given list ID.

You can view and edit a list in the Klaviyo UI at https://www.klaviyo.com/lists/{LIST_ID}`,
  {
    listId: z.string().describe("The list ID."),
    includeProfileCount: z
      .boolean()
      .optional()
      .describe("Whether to include the profile count. Only set if requested."),
  },
  async ({ listId, includeProfileCount }) => {
    try {
      const response = await klaviyoApi("GET", `/lists/${listId}/`, {
        query: {
          include: "tags",
          "additional-fields[list]": includeProfileCount ? ["profile_count"] : undefined,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

server.tool(
  "get_metrics",
  `Get all metrics in an account.

You can view and edit a metric in the Klaviyo UI at https://www.klaviyo.com/metric/{METRIC_ID}/{METRIC_NAME}`,
  {
    fields: fieldsSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ fields, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/metrics/", {
        query: {
          "fields[metric]": fields,
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_metric",
  `Get a metric with the given metric ID.

You can view and edit a metric in the Klaviyo UI at https://www.klaviyo.com/metric/{METRIC_ID}/{METRIC_NAME}`,
  {
    metricId: z.string().describe("The metric ID."),
  },
  async ({ metricId }) => {
    try {
      const response = await klaviyoApi("GET", `/metrics/${metricId}/`);
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

server.tool(
  "get_profiles",
  `Get all profiles in an account.

You can view and edit a profile in the Klaviyo UI at https://www.klaviyo.com/profile/{PROFILE_ID}`,
  {
    fields: fieldsSchema,
    sort: sortSchema,
    filter: filterSchema,
    pageSize: z.number().int().positive().max(100).optional().describe("Default 5."),
    pageCursor: pageCursorSchema,
  },
  async ({ fields, sort, filter, pageSize, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/profiles/", {
        query: {
          "fields[profile]": fields,
          sort,
          filter,
          "page[size]": pageSize ?? 5,
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_profile",
  `Get details of the profile with the given profile ID. Includes additional information about their subscriptions.

You can view and edit a profile in the Klaviyo UI at https://www.klaviyo.com/profile/{PROFILE_ID}`,
  {
    profileId: z.string().describe("The profile ID."),
  },
  async ({ profileId }) => {
    try {
      const response = await klaviyoApi("GET", `/profiles/${profileId}/`, {
        query: { "additional-fields[profile]": ["subscriptions"] },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "create_profile",
  `Create a new profile. Must include either email, phone_number, or external_id.

You can view and edit a profile in the Klaviyo UI at https://www.klaviyo.com/profile/{PROFILE_ID}`,
  {
    profileData: z
      .record(z.any())
      .describe(
        "Profile `attributes` per Klaviyo's API. Must include at least one of `email`, `phone_number`, or `external_id`. See https://developers.klaviyo.com/en/reference/create_profile.",
      ),
  },
  async ({ profileData }) => {
    try {
      const response = await klaviyoApi("POST", "/profiles/", {
        body: { data: { type: "profile", attributes: profileData } },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "update_profile",
  `Update the profile with the given profile ID.

You can view and edit a profile in the Klaviyo UI at https://www.klaviyo.com/profile/{PROFILE_ID}`,
  {
    profileId: z.string().describe("The profile ID."),
    profileUpdateData: z.record(z.any()).describe("Profile `attributes` to update."),
    patchProperties: z
      .record(z.any())
      .optional()
      .describe(
        "Patch operations to apply to custom properties. See https://developers.klaviyo.com/en/reference/update_profile.",
      ),
  },
  async ({ profileId, profileUpdateData, patchProperties }) => {
    try {
      const body = {
        data: {
          type: "profile",
          id: profileId,
          attributes: profileUpdateData,
        },
      };
      if (patchProperties) {
        body.data.meta = { patch_properties: patchProperties };
      }
      const response = await klaviyoApi("PATCH", `/profiles/${profileId}/`, { body });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const reportTimeframeSchema = z
  .record(z.any())
  .optional()
  .describe(
    `Timeframe object. Either a preset like {"key":"last_30_days"} or a custom range like {"start":"2024-01-01T00:00:00Z","end":"2024-01-31T23:59:59Z"}. Max length 1 year. Defaults to last_30_days.`,
  );

server.tool(
  "get_campaign_report",
  `Returns metrics data for campaigns with the given filters and within the given timeframe. Can return performance data such as opens, clicks, and conversions, etc.

This tool will also give you information about each campaign in the report, such as:
- audience names and IDs for the campaign. Included audiences are audiences sent the campaign, excluded audiences are audiences not sent the campaign. Excluded audiences can remove profiles from the included audiences.
- campaign name (if available)
- send time (if available)
- send channel (if available)
- campaign ID`,
  {
    statistics: z.array(z.string()).describe("List of statistics to query for."),
    conversionMetricId: z
      .string()
      .describe(
        "ID of the metric for conversion statistics. Use get_metrics with `fields=['name']` to find candidates; prefer `Placed Order`.",
      ),
    valueStatistics: z
      .array(z.string())
      .optional()
      .describe(
        "Value statistics (e.g. revenue_per_recipient). If the conversion metric does not support value queries, retry with an empty list.",
      ),
    timeframe: reportTimeframeSchema,
    filter: filterSchema,
  },
  async ({ statistics, conversionMetricId, valueStatistics, timeframe, filter }) => {
    try {
      const allStats = [...statistics, ...(valueStatistics || [])];
      const response = await klaviyoApi("POST", "/campaign-values-reports/", {
        body: {
          data: {
            type: "campaign-values-report",
            attributes: {
              statistics: allStats,
              conversion_metric_id: conversionMetricId,
              timeframe: timeframe ?? { key: "last_30_days" },
              filter: filter ?? null,
            },
          },
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_flow_report",
  `Returns metrics data for flows with the given filters and within the given timeframe. Can return performance data such as opens, clicks, and conversions, etc.

This tool will also give you information about each flow in the report, such as:
- flow name (if available)
- trigger type (if available)
- flow ID`,
  {
    statistics: z.array(z.string()).describe("List of statistics to query for."),
    conversionMetricId: z
      .string()
      .describe(
        "ID of the metric for conversion statistics. Use get_metrics with `fields=['name']` to find candidates; prefer `Placed Order`.",
      ),
    valueStatistics: z
      .array(z.string())
      .optional()
      .describe("Value statistics. Retry empty if the conversion metric rejects them."),
    timeframe: reportTimeframeSchema,
    filter: filterSchema,
  },
  async ({ statistics, conversionMetricId, valueStatistics, timeframe, filter }) => {
    try {
      const allStats = [...statistics, ...(valueStatistics || [])];
      const response = await klaviyoApi("POST", "/flow-values-reports/", {
        body: {
          data: {
            type: "flow-values-report",
            attributes: {
              statistics: allStats,
              conversion_metric_id: conversionMetricId,
              timeframe: timeframe ?? { key: "last_30_days" },
              filter: filter ?? null,
            },
          },
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

server.tool(
  "get_segments",
  `Get all segments in an account.

To filter by tag, do not use the 'filters' parameter. Instead, call this and look for the 'tags' property.

You can view and edit a segment in the Klaviyo UI at https://www.klaviyo.com/lists/{SEGMENT_ID}`,
  {
    fields: fieldsSchema,
    filter: filterSchema,
    sort: sortSchema,
    pageCursor: pageCursorSchema,
  },
  async ({ fields, filter, sort, pageCursor }) => {
    try {
      const response = await klaviyoApi("GET", "/segments/", {
        query: {
          "fields[segment]": fields,
          filter,
          sort,
          include: "tags",
          "page[cursor]": pageCursor,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_segment",
  `Get a segment with the given segment ID.

You can view and edit a segment in the Klaviyo UI at https://www.klaviyo.com/lists/{SEGMENT_ID}`,
  {
    segmentId: z.string().describe("The segment ID."),
    includeProfileCount: z
      .boolean()
      .optional()
      .describe("Whether to include the profile count. Only set if requested."),
  },
  async ({ segmentId, includeProfileCount }) => {
    try {
      const response = await klaviyoApi("GET", `/segments/${segmentId}/`, {
        query: {
          include: "tags",
          "additional-fields[segment]": includeProfileCount ? ["profile_count"] : undefined,
        },
      });
      cleanResult(response.data);
      return ok(response);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

server.tool(
  "subscribe_profile_to_marketing",
  `Subscribe a profile to marketing for a given channel. Returns "Success" if successful.`,
  {
    channels: z
      .array(z.enum(["email", "sms"]))
      .min(1)
      .describe("Channels to subscribe."),
    listId: z.string().optional().describe("Optional list to subscribe the profile to."),
    profileId: z.string().optional().describe("Optional profile ID if it already exists."),
    emailAddress: z.string().optional().describe("Required if the email channel is included."),
    phoneNumber: z.string().optional().describe("Required if the sms channel is included."),
  },
  async ({ channels, listId, profileId, emailAddress, phoneNumber }) => {
    try {
      const subscriptions = {};
      for (const c of channels) {
        subscriptions[c] = { marketing: { consent: "SUBSCRIBED" } };
      }
      const profileAttributes = {
        id: profileId || null,
        subscriptions,
        email: emailAddress || null,
        phone_number: phoneNumber || null,
      };
      const data = {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          profiles: { data: [{ type: "profile", attributes: profileAttributes }] },
          historical_import: false,
        },
      };
      if (listId) {
        data.relationships = { list: { data: { type: "list", id: listId } } };
      }
      await klaviyoApi("POST", "/profile-subscription-bulk-create-jobs/", {
        body: { data },
      });
      return ok({ status: "Success" });
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "unsubscribe_profile_from_marketing",
  `Unsubscribe a profile from marketing for a given channel. Returns "Success" if successful.`,
  {
    channels: z
      .array(z.enum(["email", "sms"]))
      .min(1)
      .describe("Channels to unsubscribe."),
    listId: z.string().optional().describe("Optional list to unsubscribe from."),
    emailAddress: z.string().optional().describe("Required if the email channel is included."),
    phoneNumber: z.string().optional().describe("Required if the sms channel is included."),
  },
  async ({ channels, listId, emailAddress, phoneNumber }) => {
    try {
      const subscriptions = {};
      for (const c of channels) {
        subscriptions[c] = { marketing: { consent: "UNSUBSCRIBED" } };
      }
      const profileAttributes = {
        subscriptions,
        email: emailAddress || null,
        phone_number: phoneNumber || null,
      };
      const data = {
        type: "profile-subscription-bulk-delete-job",
        attributes: {
          profiles: { data: [{ type: "profile", attributes: profileAttributes }] },
        },
      };
      if (listId) {
        data.relationships = { list: { data: { type: "list", id: listId } } };
      }
      await klaviyoApi("POST", "/profile-subscription-bulk-delete-jobs/", {
        body: { data },
      });
      return ok({ status: "Success" });
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const HTML_PARAM_DESCRIPTION = `The complete HTML of the template. Should include <html> and <body> tags.
To include an image, first upload the image using the upload_image_from_file or upload_image_from_url tool, then use the returned image URL.
Always include an unsubscribe link. Do this by inserting the template string "{% unsubscribe 'Unsubscribe' %}". You can replace 'Unsubscribe' with custom text.

To add an editable region to the template, ensure the hasEditableRegions param is true and add the following:
<td align="center" data-klaviyo-region="true" data-klaviyo-region-width-pixels="600"></td>

To add an editable text block, add the following within that region:
<div class="klaviyo-block klaviyo-text-block">Hello world!</div>

To add an editable image block, add the following within that region:
<div class="klaviyo-block klaviyo-image-block"></div>

To add a universal content block, add the following within that region, replacing block_id with the ID of the universal content block:
<div data-klaviyo-universal-block="block_id">&nbsp;</div>`;

server.tool(
  "create_email_template",
  `Create a new email template from the given HTML. Returns the ID of the template.

You can view and edit a template in the Klaviyo UI at https://www.klaviyo.com/email-editor/{TEMPLATE_ID}/edit.`,
  {
    name: z.string().describe("The name of the template."),
    html: z.string().describe(HTML_PARAM_DESCRIPTION),
    hasEditableRegions: z
      .boolean()
      .optional()
      .describe(
        "Whether the template HTML contains editable regions. Default false unless an editable/drag-and-drop/hybrid template is explicitly requested.",
      ),
  },
  async ({ name, html, hasEditableRegions }) => {
    try {
      const response = await klaviyoApi("POST", "/templates/", {
        body: {
          data: {
            type: "template",
            attributes: {
              name,
              editor_type: hasEditableRegions ? "USER_DRAGGABLE" : "CODE",
              html,
            },
          },
        },
      });
      return ok({ id: response?.data?.id });
    } catch (err) {
      return fail(err);
    }
  },
);

server.tool(
  "get_email_template",
  `Get an email template with the given data. Returns attributes including the html or amp.

You can view and edit a template in the Klaviyo UI at https://www.klaviyo.com/email-editor/{TEMPLATE_ID}/edit.`,
  {
    templateId: z.string().describe("The ID of the template to return."),
  },
  async ({ templateId }) => {
    try {
      const response = await klaviyoApi("GET", `/templates/${templateId}/`);
      cleanResult(response?.data);
      return ok(response?.data);
    } catch (err) {
      return fail(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Klaviyo MCP server failed to start:", err);
  process.exit(1);
});
