/**
 * `find_page_url` core tool: look up a real page of the organization's website
 * (sitemap index plus imported documents) before linking to it, so the AI
 * never has to guess a URL.
 */

import { siteIndexService } from "@server/services/site-index.service";
import type { CoreToolDefinition } from "./index";

export const findPageUrlTool: CoreToolDefinition = {
  name: "find_page_url",
  description:
    "Find the real URL of a page on the company's website before you link to it (e.g. the sales " +
    "page, shipping policy, contact page). Returns up to 5 matching pages; link only to one of " +
    "them. An empty list means no such page is known: do not link, and hand off if the customer " +
    "needs that page.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "A few words likely to appear in the page's address or title, in the website's language " +
          '(e.g. "sale", "shipping returns", "contact").',
      },
    },
  },

  async execute(conversation, args) {
    const query = typeof args.query === "string" ? args.query : "";
    const pages = await siteIndexService.search(conversation.organization_id, query);
    return pages.length > 0
      ? { pages }
      : { pages: [], note: "No matching page is known. Do not make up a link." };
  },
};
