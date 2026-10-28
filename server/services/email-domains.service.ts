import { AppDataSource } from "@server/database/data-source";
import {
  EmailSendingDomain,
  type EmailDomainRecord,
} from "@server/database/entities/email-sending-domain.entity";
import { createLogger } from "@server/lib/logger";

/**
 * Custom email sending domains (D13-9). Optional upgrade: by default the email
 * channel sends from the platform address. An organization registers its own
 * domain with Resend, adds the DNS records shown in the dashboard, and once
 * Resend reports the domain verified, plugins may send From an address on it.
 *
 * Core owns the Resend calls and the verified state so a plugin can never
 * claim a domain it does not control.
 */

const logger = createLogger("email-domains");
const RESEND_API_BASE = "https://api.resend.com";

export class EmailDomainError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "invalid_domain" | "conflict" | "provider_error",
  ) {
    super(message);
  }
}

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  records?: Array<{
    record: string;
    name: string;
    type: string;
    value: string;
    ttl?: string;
    priority?: number;
    status?: string;
  }>;
}

const DOMAIN_PATTERN = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Lowercase domain, or null when it is not a plausible domain name. */
export function normalizeDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

/** Domain part of an email address, lowercased ("" when there is none). */
export function addressDomain(address: string): string {
  const parts = address.trim().toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : "";
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new EmailDomainError("Custom sending domains are not available", "not_configured");
  }
  return key;
}

async function resend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    logger.warn({ method, path, status: response.status, body: text.slice(0, 500) }, "Resend call failed");
    throw new EmailDomainError(`Resend returned ${response.status}`, "provider_error");
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function toRecords(domain: ResendDomain): EmailDomainRecord[] {
  return (domain.records ?? []).map((record) => ({
    record: record.record,
    name: record.name,
    type: record.type,
    value: record.value,
    ttl: record.ttl,
    priority: record.priority,
    status: record.status,
  }));
}

function repository() {
  return AppDataSource.getRepository(EmailSendingDomain);
}

function applyRemote(row: EmailSendingDomain, remote: ResendDomain): void {
  row.status = remote.status;
  if (remote.records) row.records = toRecords(remote);
  if (remote.status === "verified" && !row.verified_at) row.verified_at = new Date();
  if (remote.status !== "verified") row.verified_at = null;
}

export const emailDomainService = {
  async get(organizationId: string): Promise<EmailSendingDomain | null> {
    return repository().findOne({ where: { organization_id: organizationId } });
  },

  /** The row with its status refreshed from Resend (falls back to the stored row). */
  async refresh(organizationId: string): Promise<EmailSendingDomain | null> {
    const row = await this.get(organizationId);
    if (!row) return null;
    try {
      applyRemote(row, await resend<ResendDomain>("GET", `/domains/${row.resend_domain_id}`));
      return await repository().save(row);
    } catch (error) {
      logger.warn({ organizationId, error }, "Could not refresh sending domain status");
      return row;
    }
  },

  async create(organizationId: string, input: string): Promise<EmailSendingDomain> {
    const domain = normalizeDomain(input);
    if (!domain) throw new EmailDomainError("That is not a valid domain", "invalid_domain");
    if (await this.get(organizationId)) {
      throw new EmailDomainError("Remove the current domain first", "conflict");
    }
    if (await repository().findOne({ where: { domain } })) {
      throw new EmailDomainError("This domain is already in use", "conflict");
    }
    const remote = await resend<ResendDomain>("POST", "/domains", { name: domain });
    const row = repository().create({
      organization_id: organizationId,
      domain,
      resend_domain_id: remote.id,
      status: remote.status ?? "not_started",
      records: toRecords(remote),
      verified_at: null,
    });
    try {
      return await repository().save(row);
    } catch (error) {
      // Lost a race on the unique constraints: give the Resend domain back.
      await resend("DELETE", `/domains/${remote.id}`).catch(() => undefined);
      throw new EmailDomainError("This domain is already in use", "conflict");
    }
  },

  /** Ask Resend to check the DNS records now, then return the refreshed row. */
  async verify(organizationId: string): Promise<EmailSendingDomain | null> {
    const row = await this.get(organizationId);
    if (!row) return null;
    await resend("POST", `/domains/${row.resend_domain_id}/verify`);
    return this.refresh(organizationId);
  },

  async remove(organizationId: string): Promise<void> {
    const row = await this.get(organizationId);
    if (!row) return;
    try {
      await resend("DELETE", `/domains/${row.resend_domain_id}`);
    } catch (error) {
      // A domain already gone from Resend must still be removable here.
      if (!(error instanceof EmailDomainError && error.code === "provider_error")) throw error;
      logger.warn({ organizationId, error }, "Resend domain delete failed; removing locally");
    }
    await repository().delete({ id: row.id });
  },

  /** The organization's verified sending domain, or null. */
  async verifiedDomain(organizationId: string): Promise<string | null> {
    const row = await this.get(organizationId);
    return row?.status === "verified" ? row.domain : null;
  },
};
