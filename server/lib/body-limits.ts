/**
 * Request body size limits for the JSON/urlencoded parsers in main.ts.
 *
 * Most requests are small, so the default is 1 MB. Routes that carry files as
 * base64 in a JSON body get more room: staff uploads (documents, avatars,
 * logos, conversation attachments, transcript imports) and plugin callbacks
 * (channel media) up to 50 MB, the public widget enough for one attachment,
 * and plugin webhooks/proxy calls for provider payloads.
 */

export const DEFAULT_BODY_LIMIT = "1mb";
const UPLOAD_BODY_LIMIT = "50mb";
const WIDGET_BODY_LIMIT = "15mb"; // one 10 MB attachment as base64 + message
const PLUGIN_BODY_LIMIT = "10mb";

/** tRPC procedures (or whole routers, ending in ".") that accept base64 files. */
const UPLOAD_PROCEDURES = [
  "documents.",
  "embeddings.",
  "pluginApi.",
  "testTranscripts.",
  "auth.uploadAvatar",
  "organizations.uploadLogo",
  "conversations.uploadAttachment",
];

function procedureMatches(procedure: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) =>
    prefix.endsWith(".") ? procedure.startsWith(prefix) : procedure === prefix,
  );
}

/** Body limit for a request path (Express `req.path`). */
export function bodyLimitForPath(path: string): string {
  if (path.startsWith("/v1/plugin-api/")) {
    return UPLOAD_BODY_LIMIT;
  }
  if (path.startsWith("/v1/plugins/") || path.startsWith("/plugins/webhooks/")) {
    return PLUGIN_BODY_LIMIT;
  }
  if (path.startsWith("/v1/")) {
    // tRPC batches several procedures in one path: /v1/a.b,c.d
    const procedures = path.slice("/v1/".length).split(",");
    if (procedures.some((procedure) => procedureMatches(procedure, UPLOAD_PROCEDURES))) {
      return UPLOAD_BODY_LIMIT;
    }
    if (procedures.some((procedure) => procedure.startsWith("publicConversations."))) {
      return WIDGET_BODY_LIMIT;
    }
  }
  return DEFAULT_BODY_LIMIT;
}
