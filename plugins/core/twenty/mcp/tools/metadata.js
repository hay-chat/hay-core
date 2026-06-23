/**
 * Metadata tools — make the plugin generic.
 *
 * Every Twenty workspace has a different schema (custom objects, custom fields,
 * custom SELECT options). These tools let the agent discover that schema at
 * runtime so the generic record tools (`*_record`) can target any object
 * and write valid field values for the user's own account.
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

/** Walk pagination and return every object metadata entry (fields inline). */
async function listObjectMetadata() {
  const all = [];
  let cursor;
  do {
    const res = await twentyApi("GET", "/objects", {
      metadata: true,
      query: { limit: 60, starting_after: cursor },
    });
    const objects = res?.data?.objects ?? res?.objects ?? [];
    all.push(...objects);
    cursor = res?.pageInfo?.hasNextPage ? res.pageInfo.endCursor : undefined;
  } while (cursor);
  return all;
}

/** Compact a field metadata entry down to what an agent needs to use it. */
function compactField(field) {
  const out = { name: field.name, label: field.label, type: field.type };
  if (Array.isArray(field.options) && field.options.length) {
    out.options = field.options.map((o) => o.value);
  }
  return out;
}

function registerMetadataTools(server) {
  server.tool(
    "list_objects",
    "List the objects (tables) in this Twenty workspace and their fields, including any " +
      "custom objects and fields. Call this first to discover the REST path (`namePlural`) and " +
      "the available field names/types before using the generic record tools. Pass `objectName` " +
      "to inspect a single object in full detail.",
    {
      objectName: z
        .string()
        .optional()
        .describe(
          "Restrict to one object by singular or plural name (e.g. 'company' or 'companies')",
        ),
    },
    async ({ objectName }) => {
      try {
        const objects = await listObjectMetadata();

        if (objectName) {
          const normalized = objectName.toLowerCase();
          const match = objects.find(
            (o) =>
              o.nameSingular?.toLowerCase() === normalized ||
              o.namePlural?.toLowerCase() === normalized ||
              o.labelSingular?.toLowerCase() === normalized ||
              o.labelPlural?.toLowerCase() === normalized,
          );
          if (!match) {
            const available = objects.map((o) => o.namePlural).filter(Boolean);
            throw new Error(
              `Object "${objectName}" not found. Available objects: ${available.join(", ")}`,
            );
          }
          return ok({
            nameSingular: match.nameSingular,
            namePlural: match.namePlural,
            labelSingular: match.labelSingular,
            isCustom: match.isCustom,
            fields: (match.fields ?? []).map(compactField),
          });
        }

        // Compact summary across all objects to keep the response token-light.
        return ok(
          objects.map((o) => ({
            nameSingular: o.nameSingular,
            namePlural: o.namePlural,
            labelSingular: o.labelSingular,
            isCustom: o.isCustom,
            fieldCount: (o.fields ?? []).length,
          })),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_select_options",
    "Get the valid options for a SELECT or MULTI_SELECT field on an object. Use this before " +
      "writing a SELECT field so you pass a valid `value` (not the label).",
    {
      objectName: z.string().describe("Object singular or plural name (e.g. 'company')"),
      fieldName: z.string().describe("Field name (e.g. 'stage')"),
    },
    async ({ objectName, fieldName }) => {
      try {
        const objects = await listObjectMetadata();
        const normalized = objectName.toLowerCase();
        const obj = objects.find(
          (o) =>
            o.nameSingular?.toLowerCase() === normalized ||
            o.namePlural?.toLowerCase() === normalized,
        );
        if (!obj) {
          const available = objects.map((o) => o.namePlural).filter(Boolean);
          throw new Error(`Object "${objectName}" not found. Available: ${available.join(", ")}`);
        }

        const fields = obj.fields ?? [];
        const target = fieldName.toLowerCase();
        const field = fields.find(
          (f) => f.name?.toLowerCase() === target || f.label?.toLowerCase() === target,
        );
        if (!field) {
          const selectFields = fields.filter((f) => Array.isArray(f.options)).map((f) => f.name);
          throw new Error(
            `Field "${fieldName}" not found on "${objectName}". ` +
              `SELECT fields available: ${selectFields.join(", ") || "(none)"}`,
          );
        }
        if (!Array.isArray(field.options)) {
          throw new Error(
            `Field "${fieldName}" on "${objectName}" is type ${field.type}, not a SELECT field.`,
          );
        }

        return ok({
          fieldName: field.name,
          type: field.type,
          options: field.options.map((o) => ({ value: o.value, label: o.label })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerMetadataTools };
