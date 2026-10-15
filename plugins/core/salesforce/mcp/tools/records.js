/**
 * Record tools — read and write a single sObject by id.
 *
 * Works against ANY object: Contact, Case, Account, Lead, custom objects, etc.
 * For finding records by criteria use `soql_query`; these operate on a known id.
 * Discover writeable fields with `describe_sobject` before create/update.
 */

const { z } = require("zod");
const { sfApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function stripAttributes(record) {
  if (!record || typeof record !== "object") return record;
  const { attributes, ...rest } = record;
  void attributes;
  return rest;
}

function registerRecordTools(server) {
  server.tool(
    "get_record",
    "Get a single record by object type and id. Optionally restrict to specific fields. " +
      "Example: sobject='Contact', id='003...'. To find an id first, use soql_query.",
    {
      sobject: z.string().describe("Object API name, e.g. 'Contact', 'Case'."),
      id: z.string().describe("The record's 15- or 18-character Salesforce id."),
      fields: z
        .array(z.string())
        .optional()
        .describe("Optional list of field API names to return. Omit to return all fields."),
    },
    async ({ sobject, id, fields }) => {
      try {
        const res = await sfApi("GET", `/sobjects/${sobject}/${id}`, {
          query: fields && fields.length ? { fields: fields.join(",") } : undefined,
        });
        return ok(stripAttributes(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "create_record",
    "Create a record of any object. `fields` is a flat map of field API name → value. " +
      "Include all fields required on create (see describe_sobject → requiredOnCreate); e.g. a " +
      "Case usually needs Subject/Status/Origin, a Contact needs LastName. Returns the new record id.",
    {
      sobject: z.string().describe("Object API name, e.g. 'Contact', 'Case'."),
      fields: z
        .record(z.any())
        .describe("Field values as a flat JSON object, e.g. { \"LastName\": \"Doe\", \"Email\": \"d@acme.com\" }."),
    },
    async ({ sobject, fields }) => {
      try {
        const res = await sfApi("POST", `/sobjects/${sobject}`, { body: fields });
        return ok(res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "update_record",
    "Update an existing record. `fields` contains only the fields to change (do not include Id). " +
      "Example: sobject='Case', id='500...', fields={ \"Status\": \"Closed\" }. Returns the id on success.",
    {
      sobject: z.string().describe("Object API name, e.g. 'Contact', 'Case'."),
      id: z.string().describe("The record's id to update."),
      fields: z
        .record(z.any())
        .describe("Fields to change as a flat JSON object. Do not include the Id field."),
    },
    async ({ sobject, id, fields }) => {
      try {
        // Salesforce returns 204 No Content on a successful PATCH.
        await sfApi("PATCH", `/sobjects/${sobject}/${id}`, { body: fields });
        return ok({ id, success: true });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerRecordTools };
