/**
 * Request body size limits for the JSON/urlencoded parsers in main.ts.
 *
 * Most requests are small, so the default is 1 MB. Routes that carry files as
 * base64 in a JSON body get more room: staff uploads (documents, avatars,
 * logos, conversation attachments, transcript imports) and plugin callbacks
 * (channel media) up to 50 MB, the public widget enough for one attachment,
 * and plugin proxy calls (including provider webhooks) for provider payloads.
 */

export const DEFAULT_BODY_LIMIT = "1mb";
export const UPLOAD_BODY_LIMIT = "50mb";
const WIDGET_BODY_LIMIT = "15mb"; // one 10 MB attachment as base64 + message
const PLUGIN_BODY_LIMIT = "10mb";
/** Bodies up to this size never need the upload check. */
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

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
  if (path.startsWith("/v1/plugins/")) {
    return PLUGIN_BODY_LIMIT;
  }
  if (path.startsWith("/v1/")) {
    // tRPC batches several procedures in one path: /v1/a.b,c.d
    const procedures = path.slice("/v1/".length).split(",");
    if (procedures.some((procedure) => procedureMatches(procedure, UPLOAD_PROCEDURES))) {
      return UPLOAD_BODY_LIMIT;
    }
    if (procedures.includes("publicConversations.sendAttachment")) {
      return WIDGET_BODY_LIMIT;
    }
  }
  return DEFAULT_BODY_LIMIT;
}

/**
 * Whether every procedure in a tRPC path is callable from any website. Batches
 * join procedures in one path, so one public name must not open up the rest.
 */
export function isPublicWidgetPath(path: string): boolean {
  if (!path.startsWith("/v1/")) return false;
  return path
    .slice("/v1/".length)
    .split(",")
    .every(
      (procedure) =>
        procedure.startsWith("publicConversations.") ||
        procedure === "webchat.getPublicConfig" ||
        procedure === "webchat.getAvailability",
    );
}
