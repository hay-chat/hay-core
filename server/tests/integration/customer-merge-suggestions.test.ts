import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { Customer } from "../../database/entities/customer.entity";
import { Conversation } from "../../database/entities/conversation.entity";
import { CustomerRepository } from "../../repositories/customer.repository";
import { ConversationRepository } from "../../repositories/conversation.repository";

/**
 * D13-13 against the real database: suggested merges (shared email or phone,
 * including email-channel and WhatsApp identities), dismissals, and a merge
 * that keeps the source's channel identity reachable.
 */
describe("customer merge suggestions", () => {
  const orgId = "c13e1300-0000-4000-8000-000000000001";
  const repository = new CustomerRepository();
  const customers = () => AppDataSource.getRepository(Customer);

  const customer = (data: Partial<Customer>) =>
    customers().save(customers().create({ organization_id: orgId, ...data }));

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Merge Org", slug: "merge-org-d13" }));
    }
  });

  beforeEach(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await customers().delete({ organization_id: orgId });
  });

  afterAll(async () => {
    await AppDataSource.getRepository(Conversation).delete({ organization_id: orgId });
    await customers().delete({ organization_id: orgId });
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
  });

  it("pairs customers sharing an email or a phone, older customer first", async () => {
    const instagram = await customer({ external_id: "instagram:1", email: "Ana@Example.com" });
    const email = await customer({ external_id: "ana@example.com" });
    const web = await customer({ external_id: "web:1", phone: "+55 (11) 99999-0000" });
    const whatsapp = await customer({ external_id: "+5511999990000" });
    await customer({ external_id: "instagram:2", email: "other@example.com" });
    await customer({ external_id: "instagram:3", phone: "123" });
    await customer({ external_id: "instagram:4", phone: "123" });

    const rows = await repository.findMergeSuggestions(orgId);
    const pairs = rows.map((r) => [r.customerId, r.duplicateId, r.reason, r.value]);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual([instagram.id, email.id, "email", "ana@example.com"]);
    expect(pairs).toContainEqual([web.id, whatsapp.id, "phone", "5511999990000"]);
  });

  it("hides a dismissed pair", async () => {
    const a = await customer({ external_id: "instagram:1", email: "ana@example.com" });
    const b = await customer({ external_id: "ana@example.com" });
    await repository.dismissMergeSuggestion(orgId, b.id, a.id);
    await repository.dismissMergeSuggestion(orgId, a.id, b.id); // idempotent
    expect(await repository.findMergeSuggestions(orgId)).toEqual([]);
  });

  it("merges, keeping the source's identity for its conversations and next messages", async () => {
    const target = await customer({ external_id: "instagram:1", name: "Ana" });
    const source = await customer({ external_id: "+5511999990000", phone: "+5511999990000" });
    const conversation = await AppDataSource.getRepository(Conversation).save(
      AppDataSource.getRepository(Conversation).create({
        organization_id: orgId,
        customer_id: source.id,
        channel: "whatsapp",
        status: "open",
        title: "",
        metadata: { whatsapp: { phoneNumberId: "1" } },
      }),
    );

    const merged = await repository.mergeCustomers(source.id, target.id, orgId);

    expect(merged?.phone).toBe("+5511999990000");
    expect(merged?.name).toBe("Ana");
    expect(merged?.external_metadata?._mergedExternalIds).toEqual(["+5511999990000"]);
    expect(await customers().findOne({ where: { id: source.id } })).toBeNull();

    const moved = await AppDataSource.getRepository(Conversation).findOneOrFail({
      where: { id: conversation.id },
    });
    expect(moved.customer_id).toBe(target.id);
    expect(moved.metadata).toEqual({
      whatsapp: { phoneNumberId: "1" },
      customerExternalId: "+5511999990000",
    });

    expect((await repository.findByExternalId("+5511999990000", orgId))?.id).toBe(target.id);
    expect((await repository.findByExternalId("instagram:1", orgId))?.id).toBe(target.id);
    expect(await repository.findByExternalId("+5500000000000", orgId)).toBeNull();
  });

  it("after a merge, each identity on a channel keeps its own active conversation", async () => {
    const target = await customer({ external_id: "+5511111111111" });
    const source = await customer({ external_id: "+5522222222222" });
    const open = (customerId: string) =>
      AppDataSource.getRepository(Conversation).save(
        AppDataSource.getRepository(Conversation).create({
          organization_id: orgId,
          customer_id: customerId,
          channel: "whatsapp",
          status: "open",
          title: "",
          metadata: {},
        }),
      );
    const targetConversation = await open(target.id);
    await repository.mergeCustomers(source.id, target.id, orgId);
    const merged = await customers().findOneByOrFail({ id: target.id });
    const conversations = new ConversationRepository();

    // The alias's inbound must not land in (and reply to) the target's thread.
    expect(
      await conversations.findActiveByCustomerAndChannel(
        merged,
        "+5522222222222",
        "whatsapp",
        orgId,
      ),
    ).toBeNull();
    expect(
      (
        await conversations.findActiveByCustomerAndChannel(
          merged,
          "+5511111111111",
          "whatsapp",
          orgId,
        )
      )?.id,
    ).toBe(targetConversation.id);

    const aliasConversation = await open(target.id);
    await AppDataSource.getRepository(Conversation).update(aliasConversation.id, {
      metadata: { customerExternalId: "+5522222222222" },
    });
    expect(
      (
        await conversations.findActiveByCustomerAndChannel(
          merged,
          "+5522222222222",
          "whatsapp",
          orgId,
        )
      )?.id,
    ).toBe(aliasConversation.id);
  });

  it("refuses to merge a customer into itself or across organizations", async () => {
    const a = await customer({ external_id: "instagram:1" });
    expect(await repository.mergeCustomers(a.id, a.id, orgId)).toBeNull();
    expect(
      await repository.mergeCustomers(a.id, "c13e1300-0000-4000-8000-0000000000ff", orgId),
    ).toBeNull();
  });
});
