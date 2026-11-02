import * as crypto from "crypto";
import { AppDataSource } from "@server/database/data-source";
import { Customer } from "@server/database/entities/customer.entity";
import { Job, JobPriority, JobStatus } from "@server/entities/job.entity";
import { PrivacyRequest } from "@server/entities/privacy-request.entity";
import { MERGED_EXTERNAL_IDS_KEY } from "@server/repositories/customer.repository";
import { pluginRegistryRepository } from "@server/repositories/plugin-registry.repository";
import { pluginInstanceRepository } from "@server/repositories/plugin-instance.repository";
import { createLogger } from "@server/lib/logger";
import { PRIVACY_DELETION_JOB_TYPE, PRIVACY_EXPORT_JOB_TYPE } from "@server/types/privacy.types";

const logger = createLogger("provider-privacy");

/** Shortest phone (digits only) matched, so a fragment never matches many customers. */
const MIN_PHONE_DIGITS = 8;

/**
 * How a provider names a data subject. Every identifier is matched within one
 * organization: external ids as channel identities (own or taken over in a
 * merge), emails case-insensitively, phones by their digits (also as an
 * external id, which is how phone-keyed channels store the sender).
 */
export interface SubjectIdentifiers {
  externalIds?: string[];
  emails?: string[];
  phones?: string[];
}

export interface ProviderRequestResult {
  /** Customers in the organization the identifiers matched. */
  matched: number;
  /** Privacy requests queued (or already in flight) for those customers. */
  requestIds: string[];
  /** Exports only: matched customers with no email to deliver the export to. */
  undeliverable: number;
}

/** Aggregate status of every request filed under one data-deletion confirmation code. */
export type ConfirmationStatus = "completed" | "in_progress" | "failed";

// A self-service request still waiting for its email link does not count: it may never run.
const IN_FLIGHT = ["verified", "processing"] as const;

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Privacy requests a provider makes on a data subject's behalf (store
 * redact/data-request webhooks, Meta's data-deletion callback). The provider
 * has already authenticated the request (signed webhook or plugin token), so
 * these skip the email verification step and queue the same export/deletion
 * jobs a verified request runs.
 */
export class ProviderPrivacyService {
  /** Customers of one organization matching any of the identifiers. */
  async findCustomers(
    organizationId: string,
    identifiers: SubjectIdentifiers,
  ): Promise<Customer[]> {
    const emails = (identifiers.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const phones = (identifiers.phones ?? [])
      .map(digits)
      .filter((phone) => phone.length >= MIN_PHONE_DIGITS);
    const externalIds = [
      ...(identifiers.externalIds ?? []).map((id) => id.trim()).filter(Boolean),
      ...phones,
    ];
    if (emails.length === 0 && externalIds.length === 0) return [];

    return AppDataSource.getRepository(Customer)
      .createQueryBuilder("customer")
      .where("customer.organization_id = :organizationId", { organizationId })
      .andWhere(
        `(lower(customer.email) = ANY(:emails)
          OR regexp_replace(coalesce(customer.phone, ''), '\\D', '', 'g') = ANY(:phones)
          OR customer.external_id = ANY(:externalIds)
          OR customer.external_metadata -> '${MERGED_EXTERNAL_IDS_KEY}' ?| CAST(:externalIds AS text[]))`,
        { emails, phones, externalIds },
      )
      .getMany();
  }

  /**
   * Queue an export or erasure for every customer of the organization the
   * identifiers match. A customer with a request of the same type already in
   * flight keeps it (providers retry webhooks). Exports are emailed to the
   * address on the customer record, the same inbox the self-service flow
   * verifies; a customer without one is counted as undeliverable.
   */
  async queueForSubject(
    type: "export" | "deletion",
    organizationId: string,
    identifiers: SubjectIdentifiers,
    source: { pluginId: string; reference?: string },
  ): Promise<ProviderRequestResult> {
    const customers = await this.findCustomers(organizationId, identifiers);
    const requestIds: string[] = [];
    let undeliverable = 0;

    for (const customer of customers) {
      if (type === "export" && !customer.email) {
        undeliverable += 1;
        continue;
      }
      requestIds.push(await this.queueForCustomer(type, customer, source));
    }

    logger.info(
      {
        organizationId,
        pluginId: source.pluginId,
        type,
        matched: customers.length,
        queued: requestIds.length,
        undeliverable,
      },
      "Provider privacy request queued",
    );
    return { matched: customers.length, requestIds, undeliverable };
  }

  private async queueForCustomer(
    type: "export" | "deletion",
    customer: Customer,
    source: { pluginId: string; reference?: string },
  ): Promise<string> {
    return AppDataSource.transaction(async (manager) => {
      // Serialize concurrent deliveries for the same customer.
      await manager.query(`SELECT id FROM customers WHERE id = $1 FOR UPDATE`, [customer.id]);
      const requestRepository = manager.getRepository(PrivacyRequest);
      const inFlight = await requestRepository
        .createQueryBuilder("request")
        .where("request.customer_id = :customerId", { customerId: customer.id })
        .andWhere("request.type = :type", { type })
        .andWhere("request.status IN (:...statuses)", { statuses: IN_FLIGHT })
        .getOne();
      if (inFlight) return inFlight.id;

      const request = requestRepository.create({
        // Exports are delivered here; erasures send no email (the provider
        // answers the data subject), so the column may stay blank.
        email: customer.email ?? "",
        customerId: customer.id,
        organizationId: customer.organization_id,
        type,
        subjectType: "customer",
        status: "verified",
        verifiedAt: new Date(),
        metadata: {
          source: `plugin:${source.pluginId}`,
          ...(source.reference ? { reference: source.reference } : {}),
        },
      });
      await requestRepository.save(request);

      const jobRepository = manager.getRepository(Job);
      const job = await jobRepository.save(
        jobRepository.create({
          title: type === "export" ? "Privacy data export" : "Privacy data deletion",
          description: `Requested by ${source.pluginId}`,
          status: JobStatus.QUEUED,
          priority: type === "export" ? JobPriority.HIGH : JobPriority.CRITICAL,
          organizationId: customer.organization_id,
          data: {
            type: type === "export" ? PRIVACY_EXPORT_JOB_TYPE : PRIVACY_DELETION_JOB_TYPE,
            requestId: request.id,
          },
        }),
      );
      request.markProcessing(job.id);
      await requestRepository.save(request);
      return request.id;
    });
  }

  /**
   * A provider data-deletion callback for a person, identified by the id the
   * provider gives them (Meta: the signed request's `user_id`). Every
   * organization with this plugin installed is searched for customers with
   * that channel identity and each match is erased. The returned confirmation
   * code is persisted with the requests (or, when nothing matched, with a
   * completed record) so its status page can report on it.
   */
  async eraseProviderIdentity(pluginId: string, identity: string): Promise<string> {
    const confirmationCode = crypto.randomUUID();
    const plugin = await pluginRegistryRepository.findByPluginId(pluginId);
    const instances = plugin ? await pluginInstanceRepository.findByPlugin(plugin.id) : [];
    const organizationIds = [...new Set(instances.map((instance) => instance.organizationId))];

    let queued = 0;
    for (const organizationId of organizationIds) {
      const result = await this.queueForSubject(
        "deletion",
        organizationId,
        { externalIds: [identity] },
        { pluginId },
      );
      queued += result.requestIds.length;
      // A request already in flight keeps its own code: file this one with it too.
      if (result.requestIds.length > 0) {
        await AppDataSource.query(
          `UPDATE privacy_requests
           SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{confirmationCodes}',
             coalesce(metadata -> 'confirmationCodes', '[]'::jsonb) || to_jsonb($1::text))
           WHERE id = ANY($2)`,
          [confirmationCode, result.requestIds],
        );
      }
    }

    if (queued === 0) {
      // Nothing held for this identity: the code still resolves, as completed.
      await AppDataSource.getRepository(PrivacyRequest).save(
        AppDataSource.getRepository(PrivacyRequest).create({
          email: "",
          type: "deletion",
          subjectType: "customer",
          status: "completed",
          completedAt: new Date(),
          metadata: {
            source: `plugin:${pluginId}`,
            confirmationCodes: [confirmationCode],
          },
        }),
      );
    }

    logger.info({ pluginId, confirmationCode, queued }, "Provider data deletion recorded");
    return confirmationCode;
  }

  /** Status of a confirmation code issued by {@link eraseProviderIdentity}, or null if unknown. */
  async getConfirmationStatus(
    pluginId: string,
    confirmationCode: string,
  ): Promise<ConfirmationStatus | null> {
    const rows: Array<{ status: string }> = await AppDataSource.query(
      `SELECT status FROM privacy_requests
       WHERE metadata ->> 'source' = $1 AND metadata -> 'confirmationCodes' ? $2`,
      [`plugin:${pluginId}`, confirmationCode],
    );
    if (rows.length === 0) return null;
    if (rows.some((row) => row.status === "failed")) return "failed";
    if (rows.every((row) => row.status === "completed")) return "completed";
    return "in_progress";
  }
}

export const providerPrivacyService = new ProviderPrivacyService();
