/**
 * Company tools — the standard Twenty `company` object.
 *
 * Only default-workspace fields are modelled (name, domainName, linkedinLink,
 * employees, address). For custom fields (stage, vertical, source, …) use the
 * generic `create_record` / `update_record` tools, and
 * `get_select_options` to discover valid SELECT values first.
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail, unwrapData, pageInfo, buildLink } = require("../lib/format");

function registerCompanyTools(server) {
  server.tool(
    "find_company_by_domain",
    "Find a company by its website domain (exact match). Returns the first match or null.",
    { domain: z.string().describe("Website domain or URL (e.g. example.com)") },
    async ({ domain }) => {
      try {
        const res = await twentyApi("GET", "/companies", {
          query: { filter: `domainName.primaryLinkUrl[eq]:${domain}`, limit: 1 },
        });
        const companies = res?.data?.companies ?? [];
        return ok(companies.length ? companies[0] : null);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "find_company_by_name",
    "Find a company by exact name. Returns the first match or null.",
    { name: z.string().describe("Company name (exact match)") },
    async ({ name }) => {
      try {
        // Quote so commas in names ("Foo, Lda") aren't read as filter separators.
        const quoted = `"${name.replace(/"/g, '\\"')}"`;
        const res = await twentyApi("GET", "/companies", {
          query: { filter: `name[eq]:${quoted}`, limit: 1 },
        });
        const companies = res?.data?.companies ?? [];
        return ok(companies.length ? companies[0] : null);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "get_company",
    "Get a single company by its Twenty CRM ID.",
    { companyId: z.string().describe("Twenty CRM company ID") },
    async ({ companyId }) => {
      try {
        const res = await twentyApi("GET", `/companies/${companyId}`);
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "search_companies",
    "Search companies by name (partial match). Returns up to `limit` results (default 20).",
    {
      query: z.string().describe("Company name to search for"),
      limit: z.number().optional().describe("Max results to return (default 20)"),
    },
    async ({ query, limit }) => {
      try {
        const res = await twentyApi("GET", "/companies", {
          query: { filter: `name[ilike]:%${query}%`, limit: limit ?? 20 },
        });
        return ok(res?.data?.companies ?? []);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "create_company",
    "Create a new company. Only `name` is required.",
    {
      name: z.string().describe("Company name"),
      domainName: z.string().optional().describe("Website domain or URL (e.g. example.com)"),
      linkedinUrl: z.string().optional().describe("LinkedIn company page URL"),
      employees: z.number().optional().describe("Number of employees (headcount)"),
      addressCity: z.string().optional().describe("City"),
      addressCountry: z.string().optional().describe("Country"),
    },
    async (args) => {
      try {
        const payload = { name: args.name };
        if (args.domainName) payload.domainName = buildLink(args.domainName);
        if (args.linkedinUrl) payload.linkedinLink = buildLink(args.linkedinUrl);
        if (args.employees !== undefined) payload.employees = args.employees;
        if (args.addressCity || args.addressCountry) {
          payload.address = {};
          if (args.addressCity) payload.address.addressCity = args.addressCity;
          if (args.addressCountry) payload.address.addressCountry = args.addressCountry;
        }
        const res = await twentyApi("POST", "/companies", { body: payload });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "update_company",
    "Update fields on an existing company. Only fields you pass are written.",
    {
      companyId: z.string().describe("Twenty CRM company ID"),
      name: z.string().optional().describe("Company name"),
      domainName: z.string().optional().describe("Website domain or URL"),
      linkedinUrl: z.string().optional().describe("LinkedIn company page URL"),
      employees: z.number().optional().describe("Number of employees (headcount)"),
      addressCity: z.string().optional().describe("City"),
      addressCountry: z.string().optional().describe("Country"),
    },
    async (args) => {
      try {
        const update = {};
        if (args.name !== undefined) update.name = args.name;
        if (args.domainName !== undefined) update.domainName = buildLink(args.domainName);
        if (args.linkedinUrl !== undefined) update.linkedinLink = buildLink(args.linkedinUrl);
        if (args.employees !== undefined) update.employees = args.employees;
        if (args.addressCity !== undefined || args.addressCountry !== undefined) {
          update.address = {};
          if (args.addressCity !== undefined) update.address.addressCity = args.addressCity;
          if (args.addressCountry !== undefined)
            update.address.addressCountry = args.addressCountry;
        }
        if (Object.keys(update).length === 0) {
          throw new Error("No fields to update were provided");
        }
        const res = await twentyApi("PATCH", `/companies/${args.companyId}`, { body: update });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "list_companies",
    "List companies with an optional raw Twenty filter expression and cursor pagination. " +
      "Filter syntax: operators are bracketed, clauses comma-separated and combined with " +
      'and(...)/or(...), e.g. "name[ilike]:%acme%", "employees[gte]:100". Use ' +
      "`list_objects` to discover filterable fields for your workspace.",
    {
      filter: z
        .string()
        .optional()
        .describe("Twenty filter expression. Omit to list all companies."),
      limit: z.number().optional().describe("Max results per page (default 50)"),
      cursor: z
        .string()
        .optional()
        .describe("Cursor from a previous response to fetch the next page"),
      orderBy: z
        .string()
        .optional()
        .describe('Order-by expression (e.g. "createdAt[DescNullsLast]")'),
    },
    async ({ filter, limit, cursor, orderBy }) => {
      try {
        const res = await twentyApi("GET", "/companies", {
          query: { filter, limit: limit ?? 50, starting_after: cursor, order_by: orderBy },
        });
        return ok({ companies: res?.data?.companies ?? [], ...pageInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerCompanyTools };
