import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * D13-9: custom sending domains. Resend calls are faked through global fetch;
 * the repository is an in-memory stand-in.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

type Row = Record<string, unknown> & { id?: string; organization_id: string; domain: string };
const rows: Row[] = [];
const repo = {
  findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
  ),
  create: jest.fn((data: Row) => ({ ...data })),
  save: jest.fn(async (row: Row) => {
    if (!row.id) {
      row.id = `row-${rows.length + 1}`;
      rows.push(row);
    }
    return row;
  }),
  delete: jest.fn(async ({ id }: { id: string }) => {
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
  }),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { getRepository: () => repo },
}));

import {
  emailDomainService,
  normalizeDomain,
  EmailDomainError,
} from "@server/services/email-domains.service";

const fetchMock = jest.fn<typeof fetch>();
const originalFetch = global.fetch;

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const records = [
  { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status: "not_started" },
  { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIGf", status: "not_started" },
];

describe("emailDomainService", () => {
  beforeEach(() => {
    rows.length = 0;
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test";
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.RESEND_API_KEY;
  });

  it("normalizes domains and rejects junk", () => {
    expect(normalizeDomain(" Acme.COM. ")).toBe("acme.com");
    expect(normalizeDomain("mail.acme.com.br")).toBe("mail.acme.com.br");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("-acme.com")).toBeNull();
  });

  it("creates the Resend domain, stores its DNS records and is not verified yet", async () => {
    fetchMock.mockImplementationOnce(() => respond({ id: "d_1", name: "acme.com", status: "not_started", records }));

    const row = await emailDomainService.create("org-1", "Acme.com");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/domains",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "acme.com" }) }),
    );
    expect(row).toMatchObject({ domain: "acme.com", resend_domain_id: "d_1", status: "not_started" });
    expect(row.records).toHaveLength(2);
    expect(await emailDomainService.verifiedDomain("org-1")).toBeNull();
  });

  it("reports the domain only once Resend says verified", async () => {
    fetchMock.mockImplementationOnce(() => respond({ id: "d_1", name: "acme.com", status: "not_started", records }));
    await emailDomainService.create("org-1", "acme.com");

    fetchMock
      .mockImplementationOnce(() => respond({ object: "domain", id: "d_1" }))
      .mockImplementationOnce(() => respond({ id: "d_1", name: "acme.com", status: "verified", records }));
    const row = await emailDomainService.verify("org-1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.resend.com/domains/d_1/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(row?.status).toBe("verified");
    expect(row?.verified_at).toBeInstanceOf(Date);
    expect(await emailDomainService.verifiedDomain("org-1")).toBe("acme.com");
  });

  it("refuses a domain another organization already registered, without calling Resend", async () => {
    rows.push({ id: "x", organization_id: "org-2", domain: "acme.com", status: "verified" });
    await expect(emailDomainService.create("org-1", "acme.com")).rejects.toMatchObject({ code: "conflict" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unavailable without RESEND_API_KEY", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(emailDomainService.create("org-1", "acme.com")).rejects.toBeInstanceOf(EmailDomainError);
  });

  it("removes the local row even when Resend no longer has the domain", async () => {
    rows.push({ id: "r1", organization_id: "org-1", domain: "acme.com", resend_domain_id: "d_1", status: "verified" });
    fetchMock.mockImplementationOnce(() => respond({ message: "not found" }, 404));
    await emailDomainService.remove("org-1");
    expect(rows).toHaveLength(0);
  });
});
