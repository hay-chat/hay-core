/**
 * People tools — the standard Twenty `person` object.
 *
 * Only fields present on a default Twenty workspace are modelled here
 * (name, emails, phones, jobTitle, city, linkedinLink, companyId). For custom
 * fields use the generic `twenty_create_record` / `twenty_update_record` tools.
 */

const { z } = require("zod");
const { twentyApi } = require("../lib/client");
const { ok, fail, unwrapData, pageInfo, buildLink, andFilter } = require("../lib/format");

function registerPeopleTools(server) {
  server.tool(
    "twenty_find_person_by_email",
    "Find a person in Twenty CRM by exact email address. Returns the first match or null.",
    { email: z.string().describe("Email address to look up") },
    async ({ email }) => {
      try {
        const res = await twentyApi("GET", "/people", {
          query: { filter: `emails.primaryEmail[eq]:${email}`, limit: 1 },
        });
        const people = res?.data?.people ?? [];
        return ok(people.length ? people[0] : null);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_get_person",
    "Get a single person by their Twenty CRM ID.",
    { personId: z.string().describe("Twenty CRM person ID") },
    async ({ personId }) => {
      try {
        const res = await twentyApi("GET", `/people/${personId}`);
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_search_people",
    "Search people by name with optional filters. Returns up to `limit` results (default 20). " +
      "For arbitrary fields, pass a raw Twenty filter expression via `filter`.",
    {
      query: z
        .string()
        .optional()
        .describe("Name to search for (partial match on first/last name)"),
      companyId: z.string().optional().describe("Restrict to people linked to this company ID"),
      jobTitle: z.string().optional().describe("Filter by job title (partial match)"),
      city: z.string().optional().describe("Filter by city (partial match)"),
      filter: z
        .string()
        .optional()
        .describe(
          'Raw Twenty filter expression, AND-combined with the above (e.g. "createdAt[gt]:2024-01-01")',
        ),
      limit: z.number().optional().describe("Max results to return (default 20)"),
    },
    async ({ query, companyId, jobTitle, city, filter, limit }) => {
      try {
        const combined = andFilter([
          query
            ? `or(name.firstName[ilike]:%${query}%,name.lastName[ilike]:%${query}%)`
            : undefined,
          companyId ? `companyId[eq]:${companyId}` : undefined,
          jobTitle ? `jobTitle[ilike]:%${jobTitle}%` : undefined,
          city ? `city[ilike]:%${city}%` : undefined,
          filter,
        ]);
        const res = await twentyApi("GET", "/people", {
          query: { filter: combined, limit: limit ?? 20 },
        });
        return ok(res?.data?.people ?? []);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_create_person",
    "Create a new person. Provide at least a name or an email. Email/phone/linkedin are " +
      "accepted at create time so capturing a contact is a single call.",
    {
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      jobTitle: z.string().optional().describe("Job title"),
      primaryEmail: z.string().optional().describe("Primary email address"),
      primaryPhone: z.string().optional().describe("Primary phone number"),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL"),
      companyId: z.string().optional().describe("Company ID to link this person to"),
      city: z.string().optional().describe("City"),
      avatarUrl: z.string().optional().describe("Avatar image URL"),
    },
    async (args) => {
      try {
        if (!args.firstName && !args.lastName && !args.primaryEmail && !args.linkedinUrl) {
          throw new Error(
            "Provide at least one of: firstName, lastName, primaryEmail, linkedinUrl",
          );
        }
        const payload = {
          name: { firstName: args.firstName || "", lastName: args.lastName || "" },
        };
        if (args.primaryEmail)
          payload.emails = { primaryEmail: args.primaryEmail, additionalEmails: [] };
        if (args.primaryPhone) payload.phones = { primaryPhoneNumber: args.primaryPhone };
        if (args.linkedinUrl) payload.linkedinLink = buildLink(args.linkedinUrl);
        if (args.jobTitle) payload.jobTitle = args.jobTitle;
        if (args.companyId) payload.companyId = args.companyId;
        if (args.city) payload.city = args.city;
        if (args.avatarUrl) payload.avatarUrl = args.avatarUrl;

        const res = await twentyApi("POST", "/people", { body: payload });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_update_person",
    "Update fields on an existing person. Only fields you pass are written. A partial " +
      "`name` (just firstName or just lastName) is merged with the existing record so the " +
      "other half is preserved.",
    {
      personId: z.string().describe("Twenty CRM person ID"),
      firstName: z.string().optional().describe("First name"),
      lastName: z.string().optional().describe("Last name"),
      jobTitle: z.string().optional().describe("Job title"),
      companyId: z.string().optional().describe("Company ID to link to"),
      primaryEmail: z.string().optional().describe("Primary email address"),
      primaryPhone: z.string().optional().describe("Primary phone number"),
      linkedinUrl: z.string().optional().describe("LinkedIn profile URL"),
      city: z.string().optional().describe("City"),
    },
    async (args) => {
      try {
        const update = {};
        if (args.jobTitle !== undefined) update.jobTitle = args.jobTitle;
        if (args.companyId !== undefined) update.companyId = args.companyId;
        if (args.city !== undefined) update.city = args.city;
        if (args.primaryEmail !== undefined) {
          update.emails = { primaryEmail: args.primaryEmail, additionalEmails: [] };
        }
        if (args.primaryPhone !== undefined) {
          update.phones = { primaryPhoneNumber: args.primaryPhone };
        }
        if (args.linkedinUrl !== undefined) update.linkedinLink = buildLink(args.linkedinUrl);

        if (args.firstName !== undefined || args.lastName !== undefined) {
          if (args.firstName !== undefined && args.lastName !== undefined) {
            update.name = { firstName: args.firstName, lastName: args.lastName };
          } else {
            // Twenty PATCH replaces the whole `name` object; merge to avoid wiping a half.
            const existing = await twentyApi("GET", `/people/${args.personId}`);
            const current = existing?.data?.person?.name ?? {};
            update.name = {
              firstName: args.firstName ?? current.firstName ?? "",
              lastName: args.lastName ?? current.lastName ?? "",
            };
          }
        }

        if (Object.keys(update).length === 0) {
          throw new Error("No fields to update were provided");
        }

        const res = await twentyApi("PATCH", `/people/${args.personId}`, { body: update });
        return ok(unwrapData(res));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    "twenty_list_people_by_company",
    "List people linked to a specific company (one page).",
    {
      companyId: z.string().describe("Twenty CRM company ID"),
      limit: z.number().optional().describe("Max results per page (default 50)"),
      cursor: z
        .string()
        .optional()
        .describe("Cursor from a previous response to fetch the next page"),
    },
    async ({ companyId, limit, cursor }) => {
      try {
        const res = await twentyApi("GET", "/people", {
          query: {
            filter: `companyId[eq]:${companyId}`,
            limit: limit ?? 50,
            starting_after: cursor,
          },
        });
        return ok({ people: res?.data?.people ?? [], ...pageInfo(res) });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

module.exports = { registerPeopleTools };
