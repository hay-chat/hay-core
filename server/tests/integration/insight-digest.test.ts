import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { UserOrganization } from "../../entities/user-organization.entity";

const mockSendTemplateEmail =
  jest.fn<(options: Record<string, unknown>) => Promise<{ success: boolean }>>();

jest.mock("../../services/email.service", () => ({
  emailService: {
    sendTemplateEmail: (options: Record<string, unknown>) => mockSendTemplateEmail(options),
  },
  getOrganizationLocale: async () => "pt",
}));

import { InsightDigestService } from "../../services/insights/insight-digest.service";
import { updateOrganizationThresholds } from "../../services/insights/insight-settings";

describe("weekly insights digest", () => {
  const orgId = "d31d0000-0000-4000-8000-000000000001";
  const ownerId = "d31d0000-0000-4000-8000-0000000000a1";
  const memberId = "d31d0000-0000-4000-8000-0000000000a2";
  const service = new InsightDigestService();

  async function cluster(overrides: Record<string, unknown> = {}): Promise<string> {
    const row = {
      polarity: "negative",
      action_type: "knowledge_add",
      signature: "negative:knowledge_add",
      title: "Shipping to Portugal is not documented",
      state: "new",
      size: 6,
      window_size: 6,
      impact_score: 10,
      promoted_at: new Date(),
      last_seen_at: new Date(),
      ...overrides,
    };
    const keys = Object.keys(row);
    const [inserted] = await AppDataSource.query(
      `INSERT INTO insight_clusters (organization_id, ${keys.join(", ")})
       VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
      [orgId, ...Object.values(row)],
    );
    return inserted.id;
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    const orgRepo = AppDataSource.getRepository(Organization);
    if (!(await orgRepo.findOne({ where: { id: orgId } }))) {
      await orgRepo.save(orgRepo.create({ id: orgId, name: "Digest Org", slug: "digest-org-d3" }));
    }
    const users = AppDataSource.getRepository(User);
    const memberships = AppDataSource.getRepository(UserOrganization);
    for (const [id, role] of [
      [ownerId, "owner"],
      [memberId, "member"],
    ] as const) {
      if (!(await users.findOne({ where: { id } }))) {
        await users.save(
          users.create({ id, email: `${id}@example.com`, password: "x", firstName: "Ana" }),
        );
      }
      if (!(await memberships.findOne({ where: { userId: id, organizationId: orgId } }))) {
        await memberships.save(
          memberships.create({ userId: id, organizationId: orgId, role, isActive: true }),
        );
      }
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSendTemplateEmail.mockResolvedValue({ success: true });
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_org_state WHERE organization_id = $1`, [orgId]);
    await updateOrganizationThresholds(orgId, { digestEnabled: true });
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM insight_org_state WHERE organization_id = $1`, [orgId]);
    await AppDataSource.getRepository(UserOrganization).delete({ organizationId: orgId });
    await AppDataSource.getRepository(User).delete([ownerId, memberId]);
    await AppDataSource.getRepository(Organization).delete({ id: orgId });
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("emails owners and admins once a week with the top insights, in the org's language", async () => {
    const top = await cluster({ impact_score: 50 });
    await cluster({ polarity: "positive", signature: "positive:none", title: "Clear answers" });

    expect(await service.organizationsWithActivity()).toContain(orgId);
    expect(await service.sendForOrganization(orgId)).toBe(true);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1); // owner only, not the member
    const email = mockSendTemplateEmail.mock.calls[0][0] as {
      to: string;
      subject: string;
      locale: string;
      variables: {
        relatedItems: Array<{ text: string; url: string }>;
        details: Array<{ label: string; value: string }>;
      };
    };
    expect(email.to).toBe(`${ownerId}@example.com`);
    expect(email.locale).toBe("pt-BR");
    expect(email.subject).toBe("Insights da semana: 2 novos");
    expect(email.variables.relatedItems[0].url).toMatch(new RegExp(`/insights/${top}$`));
    expect(email.variables.details[0]).toEqual({ label: "Novos", value: "2" });

    // Already sent this week.
    expect(await service.sendForOrganization(orgId)).toBe(false);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);
  });

  it("does not mark the week sent when every email fails, so the next run retries (F7)", async () => {
    await cluster();
    mockSendTemplateEmail.mockResolvedValueOnce({ success: false });
    expect(await service.sendForOrganization(orgId)).toBe(false);
    const [state] = await AppDataSource.query(
      `SELECT digest_last_sent_at FROM insight_org_state WHERE organization_id = $1`,
      [orgId],
    );
    expect(state.digest_last_sent_at).toBeNull();

    mockSendTemplateEmail.mockRejectedValueOnce(new Error("SMTP down"));
    expect(await service.sendForOrganization(orgId)).toBe(false);

    expect(await service.sendForOrganization(orgId)).toBe(true);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(3);
  });

  it("sends once when two runs start together", async () => {
    await cluster();
    const results = await Promise.all([
      service.sendForOrganization(orgId),
      service.sendForOrganization(orgId),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mockSendTemplateEmail).toHaveBeenCalledTimes(1);
  });

  it("respects the owner's opt-out and skips quiet weeks", async () => {
    await updateOrganizationThresholds(orgId, { digestEnabled: false });
    await cluster();
    expect(await service.sendForOrganization(orgId)).toBe(false);

    await updateOrganizationThresholds(orgId, { digestEnabled: true });
    await AppDataSource.query(`DELETE FROM insight_clusters WHERE organization_id = $1`, [orgId]);
    expect(await service.sendForOrganization(orgId)).toBe(false);
    expect(mockSendTemplateEmail).not.toHaveBeenCalled();
  });
});
