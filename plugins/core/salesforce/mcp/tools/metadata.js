/**
 * Metadata tools — discover which objects and fields the org exposes.
 *
 * Salesforce orgs differ: custom objects, custom fields, picklist values, and
 * which fields are required or updateable all vary. Use these before building a
 * SOQL query or a create/update payload so you reference real, writeable fields.
 */

const { z } = require("zod");
const { sfApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerMetadataTools(server) {
  server.tool(
    "list_sobjects",
    "List the queryable/creatable objects (sObjects) available in this Salesforce org, e.g. " +
      "Contact, Case, Account, Lead. Returns each object's API name (use it as `sobject` in the " +
      "other tools) and labels. Filter with `search` to narrow the (often long) list.",
    {
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring to match against object API name or label (e.g. 'case')."),
    },
    async ({ search }) => {
      try {
        const res = await sfApi("GET", "/sobjects");
        let objects = (res?.sobjects ?? []).map((o) => ({
          name: o.name,
          label: o.label,
          custom: o.custom,
          queryable: o.queryable,
          createable: o.createable,
          updateable: o.updateable,
        }));
        if (search) {
          const needle = search.toLowerCase();
          objects = objects.filter(
            (o) =>
              o.name.toLowerCase().includes(needle) ||
              (o.label || "").toLowerCase().includes(needle),
          );
        }
        return ok({ count: objects.length, objects });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "describe_sobject",
    "Describe a single object's fields: API name, label, type, whether it is required on create " +
      "and whether it is updateable, plus picklist values. Call this before crafting a SOQL query " +
      "or a create_record/update_record payload. Example sobject values: 'Contact', 'Case'.",
    {
      sobject: z.string().describe("The object API name, e.g. 'Contact', 'Case', 'Account'."),
    },
    async ({ sobject }) => {
      try {
        const res = await sfApi("GET", `/sobjects/${sobject}/describe`);
        const fields = (res?.fields ?? []).map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          // `nillable: false` + no default + creatable ⇒ required on create.
          requiredOnCreate: f.createable && !f.nillable && !f.defaultedOnCreate,
          updateable: f.updateable,
          ...(f.picklistValues && f.picklistValues.length
            ? { picklistValues: f.picklistValues.filter((p) => p.active).map((p) => p.value) }
            : {}),
          ...(f.referenceTo && f.referenceTo.length ? { referenceTo: f.referenceTo } : {}),
        }));
        return ok({
          name: res?.name,
          label: res?.label,
          createable: res?.createable,
          updateable: res?.updateable,
          fields,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerMetadataTools };
