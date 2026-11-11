import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { ConversationRepository } from "../../repositories/conversation.repository";
import type { ListParams } from "../../trpc/middleware/pagination";

/**
 * DB-backed: the conversation search is SQL (EXISTS over messages and jsonb
 * translations), so only a real query shows what it matches.
 */
describe("conversation search", () => {
  const orgId = "5ea4c400-0000-4000-8000-000000000001";
  const otherOrgId = "5ea4c400-0000-4000-8000-000000000002";
  const repository = new ConversationRepository();
  const ids: Record<string, string> = {};

  const search = async (query: string, organizationId = orgId) => {
    const params: ListParams = {
      pagination: { page: 1, limit: 50, offset: 0 },
      sorting: { orderBy: "created_at", orderDirection: "desc" },
      search: { query, searchFields: ["title"] },
    };
    const result = await repository.paginateQuery(params, organizationId);
    return result.items.map((item) => item.id).sort();
  };

  async function seed(
    key: string,
    organizationId: string,
    title: string,
    extra: { summary?: string; translations?: object } = {},
  ) {
    const [row] = await AppDataSource.query(
      `INSERT INTO conversations (title, organization_id, status, summary, translations)
       VALUES ($1, $2, 'open', $3, $4) RETURNING id`,
      [title, organizationId, extra.summary ?? null, extra.translations ?? null],
    );
    ids[key] = row.id;
    return row.id as string;
  }

  async function message(
    conversationId: string,
    type: string,
    content: string,
    translations: object | null = null,
  ) {
    await AppDataSource.query(
      `INSERT INTO messages (conversation_id, content, type, translations) VALUES ($1, $2, $3, $4)`,
      [conversationId, content, type, translations],
    );
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();

    const orgRepo = AppDataSource.getRepository(Organization);
    for (const [id, slug] of [
      [orgId, "search-test-org"],
      [otherOrgId, "search-test-other"],
    ]) {
      if (!(await orgRepo.findOne({ where: { id } }))) {
        await orgRepo.save(orgRepo.create({ id, name: slug, slug }));
      }
    }
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: otherOrgId });

    await seed("title", orgId, "Refund for blue kettle");
    await seed("summary", orgId, "Shipping", {
      summary: "Customer wants the parcel rerouted",
      translations: {
        summary: {
          sourceHash: "x",
          sourceLanguage: "en",
          text: { nl: "Klant wil het pakket omleiden" },
        },
      },
    });
    const customer = await seed("customer", orgId, "Question");
    await message(customer, "Customer", "Where is my order 4471?", {
      nl: "Waar is mijn bestelling 4471?",
    });
    const quoted = await seed("quoted", orgId, "Quote");
    await message(quoted, "BotAgent", "Sent", { nl: 'Hij zei "zeker weten" gisteren' });
    const internal = await seed("internal", orgId, "Internal");
    await message(internal, "System", "secret-system-marker");
    const other = await seed("other", otherOrgId, "Other");
    await message(other, "Customer", "Where is my order 4471?");
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await AppDataSource.getRepository(Conversation).delete({ organization_id: otherOrgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: otherOrgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("matches titles, summaries and cached summary translations", async () => {
    expect(await search("blue KETTLE")).toEqual([ids.title]);
    expect(await search("rerouted")).toEqual([ids.summary]);
    expect(await search("pakket omleiden")).toEqual([ids.summary]);
  });

  it("matches message text and message translations, only in the organization", async () => {
    expect(await search("order 4471")).toEqual([ids.customer]);
    expect(await search("mijn bestelling")).toEqual([ids.customer]);
    expect(await search('"zeker weten"')).toEqual([ids.quoted]);
    expect(await search("order 4471", otherOrgId)).toEqual([ids.other]);
  });

  it("ignores system messages, language codes and LIKE wildcards", async () => {
    expect(await search("secret-system-marker")).toEqual([]);
    expect(await search("nl")).toEqual([]);
    expect(await search("sourceHash")).toEqual([]);
    expect(await search("%")).toEqual([]);
  });
});
