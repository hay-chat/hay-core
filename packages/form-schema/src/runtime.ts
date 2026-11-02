// The subset the webchat widget uses: types, the response validator and the
// renderers. No zod here, on purpose: the widget installs its own
// dependencies and ships inside a size budget. Parsing a schema (schema.ts)
// is the server's and the dashboard's job.
export * from "./types";
export * from "./validate";
export * from "./render";
