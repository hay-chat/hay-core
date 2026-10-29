/**
 * Community info tools — the FAQ playbooks ("what's the Wi-Fi?", "anything on
 * this week?", "do members get discounts?", "how much is a membership?").
 *
 *   spacebring_search_guides  GET guides → rank → GET full text of the best matches
 *   spacebring_whats_on       GET events + GET feed posts, in parallel
 *   spacebring_list_perks     GET benefits (filtered)
 *   spacebring_list_plans     GET plans
 */

const { z } = require("zod");
const { sbApi, sbListAll, listOf, itemOf } = require("../lib/client");
const { handle, norm, formatLocal } = require("../lib/format");
const { resolveLocation } = require("../lib/spacebring");

const LOCATION = z.string().optional().describe("Location name or id. Omit for the default.");
const MAX_GUIDE_CHARS = 4000;

const titleOf = (x) => x.title ?? x.name ?? null;
const bodyOf = (x) => x.content ?? x.text ?? x.description ?? x.body ?? "";
const clip = (text, max) =>
  typeof text === "string" && text.length > max ? `${text.slice(0, max)}…` : text || null;

/**
 * Score how well `item` matches the query tokens: title hits weigh more than
 * body hits. Spaces are also ignored, so "wifi" finds "Wi-Fi".
 */
function score(item, tokens) {
  const title = norm(titleOf(item));
  const body = norm(bodyOf(item));
  const has = (text, t) => text.includes(t) || text.replace(/ /g, "").includes(t);
  return tokens.reduce((sum, t) => sum + (has(title, t) ? 3 : 0) + (has(body, t) ? 1 : 0), 0);
}

const STOP_WORDS = new Set(
  "the an is what whats how do to of for my in and qual como de da do para onde".split(" "),
);

function queryTokens(query) {
  return norm(query)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function registerCommunityTools(server) {
  server.tool(
    "spacebring_search_guides",
    "Answer house questions from the space's guides (READ): Wi-Fi name and password, opening " +
      "hours, printing, kitchen, house rules, parking, access. Pass the member's question or its " +
      "keywords; returns the full text of the best-matching guides. Answer only from what they " +
      "say; if nothing matches, say so instead of guessing.",
    {
      query: z
        .string()
        .optional()
        .describe('The question or keywords, e.g. "wifi password". Omit to list all guide titles.'),
      location: LOCATION,
    },
    handle(async (args) => {
      const location = await resolveLocation(args.location);
      const { items } = await sbListAll(
        "/guides/v1",
        "guides",
        { locationRef: location.id },
        { maxPages: 3 },
      );
      const titles = items.map(titleOf).filter(Boolean);
      const tokens = queryTokens(args.query);

      if (!tokens.length) {
        return {
          guides: titles,
          summary: `${titles.length} guides. Call again with a query to read the relevant one.`,
        };
      }

      const ranked = items
        .map((g) => ({ g, s: score(g, tokens) }))
        .filter(({ s }) => s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3)
        .map(({ g }) => g);
      if (!ranked.length) {
        return {
          matches: [],
          otherGuides: titles,
          summary:
            `No guide mentions "${args.query}". Do not guess: tell the member you will check ` +
            "with the team, or report it with spacebring_report_issue if something is wrong.",
        };
      }

      const full = await Promise.all(
        ranked.map(async (g) =>
          bodyOf(g) && bodyOf(g).length > 200
            ? g
            : itemOf(await sbApi("GET", `/guides/v1/${encodeURIComponent(g.id)}`), "guide"),
        ),
      );
      return {
        matches: full.map((g) => ({
          title: titleOf(g),
          content: clip(bodyOf(g), MAX_GUIDE_CHARS),
        })),
        otherGuides: titles.filter((t) => !full.some((g) => titleOf(g) === t)),
        summary: `Best match: "${titleOf(full[0])}". Answer from its content.`,
      };
    }),
  );

  server.tool(
    "spacebring_whats_on",
    "What's happening at the space (READ): upcoming community events and the latest " +
      "announcements from the feed. Use for 'any events this week?', 'any news?', 'is there " +
      "anything on Friday?'.",
    {
      days: z
        .number()
        .optional()
        .describe("How many days ahead to look for events (default 14, max 90)."),
      location: LOCATION,
    },
    handle(async (args) => {
      const location = await resolveLocation(args.location);
      const days = Math.min(Math.max(Math.round(args.days ?? 14), 1), 90);
      const now = new Date();
      const until = new Date(now.getTime() + days * 86400000);

      const [events, feed] = await Promise.all([
        sbListAll(
          "/events/v1",
          "events",
          { locationRef: location.id, order: "startDate:asc" },
          { maxPages: 3 },
        ),
        sbApi("GET", "/feed/posts/v1", { query: { locationRef: location.id, limit: 5 } }),
      ]);
      const upcoming = events.items
        .filter((e) => {
          const start = new Date(e.startDate);
          const end = new Date(e.endDate ?? e.startDate);
          return end >= now && start <= until;
        })
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
        .slice(0, 15)
        .map((e) => ({
          id: e.id,
          title: titleOf(e),
          when: formatLocal(e.startDate, location.timeZone),
          venue: e.venue?.name ?? e.venue ?? e.place ?? null,
          description: clip(bodyOf(e), 400),
          price: e.price ?? null,
        }));
      const announcements = listOf(feed, "posts")
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          posted: p.createDate ? formatLocal(p.createDate, location.timeZone) : null,
          title: titleOf(p),
          text: clip(bodyOf(p), 500),
        }));

      return {
        timeZone: location.timeZone,
        events: upcoming,
        announcements,
        summary:
          `${upcoming.length} event(s) in the next ${days} days` +
          (announcements.length
            ? `; latest announcement: "${announcements[0].title ?? clip(announcements[0].text, 80)}".`
            : "."),
      };
    }),
  );

  server.tool(
    "spacebring_list_perks",
    "List member perks and partner discounts (READ), optionally filtered by a keyword such as " +
      '"gym", "coffee" or "software". Includes how to redeem each one.',
    {
      query: z.string().optional().describe("Optional keyword to filter perks."),
      location: LOCATION,
    },
    handle(async (args) => {
      const location = await resolveLocation(args.location);
      const { items } = await sbListAll(
        "/benefits/v1",
        "benefits",
        { locationRef: location.id },
        { maxPages: 2 },
      );
      const tokens = queryTokens(args.query);
      const matched = tokens.length ? items.filter((b) => score(b, tokens) > 0) : items;
      return {
        perks: matched.slice(0, 20).map((b) => ({
          title: titleOf(b),
          description: clip(bodyOf(b), 600),
          redeem: b.redeemUrl ?? b.url ?? b.link ?? b.code ?? null,
        })),
        summary: tokens.length
          ? `${matched.length} perk(s) match "${args.query}" (of ${items.length}).`
          : `${items.length} perk(s).`,
      };
    }),
  );

  server.tool(
    "spacebring_list_plans",
    "List the membership plans on offer with their prices (READ). Use for prospects asking " +
      "'how much is a hot desk?' or members asking about upgrading. Signing up or changing plan " +
      "is done by the team: offer to pass the request on.",
    { location: LOCATION },
    handle(async (args) => {
      const location = await resolveLocation(args.location);
      const { items } = await sbListAll(
        "/plans/v1",
        "plans",
        { locationRef: location.id },
        { maxPages: 2 },
      );
      return {
        plans: items.slice(0, 20).map((p) => ({
          name: titleOf(p),
          price: p.price ?? p.amount ?? null,
          currency: p.currency ?? null,
          period: p.period ?? p.interval ?? p.billingPeriod ?? null,
          description: clip(bodyOf(p), 400),
        })),
        summary: `${items.length} plan(s) at ${location.name}.`,
      };
    }),
  );
}

module.exports = { registerCommunityTools, queryTokens, score };
