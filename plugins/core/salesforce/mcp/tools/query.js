/**
 * SOQL query tools — the primary way to READ Salesforce data.
 *
 * SOQL reads any object and any field, so this covers searching Contacts and
 * Cases by email, name, status, owner, etc. Use `describe_sobject` first if you
 * are unsure which fields exist.
 *
 *   SELECT Id, Name, Email FROM Contact WHERE Email = 'jane@acme.com'
 *   SELECT Id, CaseNumber, Subject, Status FROM Case WHERE Status != 'Closed' ORDER BY CreatedDate DESC
 */

const { z } = require("zod");
const { sfApi } = require("../lib/client");
const { ok, fail } = require("../lib/format");

function registerQueryTools(server) {
  server.tool(
    "soql_query",
    "Run a SOQL query to read records from Salesforce (any object/field). This is the main way " +
      "to find Contacts, Cases, Accounts, Leads, etc. Returns up to ~2000 rows per call; if " +
      "`done` is false pass `nextRecordsLocator` to `query_more` to page through the rest. " +
      "Example: SELECT Id, Name, Email FROM Contact WHERE Email = 'jane@acme.com'. " +
      "Use single quotes for string literals and escape them by doubling ('') inside values.",
    {
      soql: z.string().describe("A complete SOQL query string, e.g. \"SELECT Id, Subject FROM Case WHERE Status = 'New'\""),
    },
    async ({ soql }) => {
      try {
        const res = await sfApi("GET", "/query", { query: { q: soql } });
        return ok(shapeQueryResult(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "query_more",
    "Fetch the next page of a `soql_query` whose `done` was false. Pass the `nextRecordsLocator` " +
      "returned by the previous call. Repeat until `done` is true.",
    {
      nextRecordsLocator: z
        .string()
        .describe("The `nextRecordsLocator` value from a previous soql_query / query_more response."),
    },
    async ({ nextRecordsLocator }) => {
      try {
        // Accept either the bare locator or the full nextRecordsUrl Salesforce returns.
        const locator = nextRecordsLocator.includes("/query/")
          ? nextRecordsLocator.split("/query/")[1]
          : nextRecordsLocator;
        const res = await sfApi("GET", `/query/${locator}`);
        return ok(shapeQueryResult(res));
      } catch (err) {
        return fail(err);
      }
    },
  );
}

/** Normalise a SOQL response to a compact, agent-friendly shape. */
function shapeQueryResult(res) {
  const result = {
    totalSize: res?.totalSize ?? 0,
    done: res?.done ?? true,
    records: stripAttributes(res?.records ?? []),
  };
  if (res && res.done === false && res.nextRecordsUrl) {
    result.nextRecordsLocator = res.nextRecordsUrl.split("/query/")[1] || res.nextRecordsUrl;
  }
  return result;
}

/**
 * Every SOQL record carries an `attributes: { type, url }` envelope that wastes
 * agent tokens. Drop it (recursively for nested relationship sub-queries).
 */
function stripAttributes(records) {
  return records.map((record) => {
    if (!record || typeof record !== "object") return record;
    const { attributes, ...rest } = record;
    void attributes;
    for (const [key, value] of Object.entries(rest)) {
      if (value && typeof value === "object" && Array.isArray(value.records)) {
        // Nested relationship query result.
        rest[key] = { ...value, records: stripAttributes(value.records) };
      } else if (value && typeof value === "object" && value.attributes) {
        // Nested parent relationship record.
        const { attributes: _a, ...child } = value;
        void _a;
        rest[key] = child;
      }
    }
    return rest;
  });
}

module.exports = { registerQueryTools };
