/**
 * Generic record tools — work against ANY Twenty object (standard or custom).
 *
 * The typed people/companies/notes/tasks tools cover the common path with
 * friendly parameters. These cover everything else: custom objects, custom
 * fields, and any field the typed tools don't expose. Discover object names and
 * field shapes first with `twenty_list_objects`.
 *
 * `objectNamePlural` is the REST path segment (e.g. "companies", "opportunities",
 * or a custom object's plural name). `data` is the raw field object Twenty
 * expects — composite fields use their nested shape, e.g.
 *   { "name": { "firstName": "Ada" }, "emails": { "primaryEmail": "a@b.com" } }
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail, unwrapData, pageInfo } = require("../lib/format");

function registerRecordTools(server) {
  server.tool(
    "twenty_list_records",
    "List records of any object with optional Twenty filter, ordering, and cursor pagination. " +
      "Use `twenty_list_objects` to find the object's `namePlural` and filterable fields.",
    {
      objectNamePlural: z.string().describe("Object plural REST name (e.g. 'opportunities')"),
      filter: z.string().optional().describe("Twenty filter expression (e.g. 'stage[eq]:NEW')"),
      limit: z.number().optional().describe("Max results per page (default 50)"),
      cursor: z.string().optional().describe("Cursor from a previous response for the next page"),
      orderBy: z
        .string()
        .optional()
        .describe("Order-by expression (e.g. 'createdAt[DescNullsLast]')"),
      depth: z
        .number()
        .optional()
        .describe("Relation depth to include (0–2). Higher values embed related records."),
    },
    async ({ objectNamePlural, filter, limit, cursor, orderBy, depth }) => {
      try {
        const res = await twentyApi("GET", `/${objectNamePlural}`, {
          query: { filter, limit: limit ?? 50, starting_after: cursor, order_by: orderBy, depth },
        });
        const records = res?.data?.[objectNamePlural] ?? unwrapData(res);
        return ok({ records, ...pageInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_get_record",
    "Get a single record of any object by its ID.",
    {
      objectNamePlural: z.string().describe("Object plural REST name (e.g. 'opportunities')"),
      recordId: z.string().describe("Record ID"),
      depth: z.number().optional().describe("Relation depth to include (0–2)"),
    },
    async ({ objectNamePlural, recordId, depth }) => {
      try {
        const res = await twentyApi("GET", `/${objectNamePlural}/${recordId}`, {
          query: { depth },
        });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_create_record",
    "Create a record of any object. `data` is the raw Twenty field object. For SELECT fields, " +
      "pass the option `value` (use `twenty_get_select_options` to find valid values). For " +
      "composite fields use the nested shape, e.g. emails: { primaryEmail }, " +
      "domainName: { primaryLinkUrl }.",
    {
      objectNamePlural: z.string().describe("Object plural REST name (e.g. 'opportunities')"),
      data: z.record(z.any()).describe("Field values as a JSON object"),
    },
    async ({ objectNamePlural, data }) => {
      try {
        const res = await twentyApi("POST", `/${objectNamePlural}`, { body: data });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_update_record",
    "Update a record of any object. `data` contains only the fields to change. Note: Twenty " +
      "replaces composite fields wholesale, so pass the full nested object for those.",
    {
      objectNamePlural: z.string().describe("Object plural REST name (e.g. 'opportunities')"),
      recordId: z.string().describe("Record ID"),
      data: z.record(z.any()).describe("Field values to update as a JSON object"),
    },
    async ({ objectNamePlural, recordId, data }) => {
      try {
        const res = await twentyApi("PATCH", `/${objectNamePlural}/${recordId}`, { body: data });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_delete_record",
    "Delete a record of any object by its ID. This is destructive — confirm the ID first.",
    {
      objectNamePlural: z.string().describe("Object plural REST name (e.g. 'opportunities')"),
      recordId: z.string().describe("Record ID to delete"),
    },
    async ({ objectNamePlural, recordId }) => {
      try {
        await twentyApi("DELETE", `/${objectNamePlural}/${recordId}`);
        return ok({ deleted: true, id: recordId });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRecordTools };
