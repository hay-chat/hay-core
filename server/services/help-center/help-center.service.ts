import crypto from "crypto";
import dns from "dns/promises";
import { TRPCError } from "@trpc/server";
import { In, IsNull, Not } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import {
  DEFAULT_HELP_CENTER_THEME,
  HelpCenter,
  type HelpCenterTheme,
} from "@server/database/entities/help-center.entity";
import { HelpCenterCollection } from "@server/database/entities/help-center-collection.entity";
import { Document, DocumentVisibility } from "@server/entities/document.entity";
import { deriveServiceKey } from "@server/lib/auth/utils/service-keys";
import { createLogger } from "@server/lib/logger";
import { auditLogService } from "@server/services/audit-log.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import { normalizeDomain } from "@server/services/sso.service";
import { clearHelpCenterHostCache, isPlatformHostname } from "./host-resolver";
import {
  CUSTOM_DOMAIN_TARGET_PREFIX,
  normalizeSubdomain,
  subdomainProblem,
  type SubdomainProblem,
} from "./subdomain";
import {
  canonicalUrl,
  customDomainTargetHostname,
  defaultUrl,
  helpCenterBaseHostname,
  isHelpCenterEnabled,
} from "./urls";

const logger = createLogger("help-center");

const POSTGRES_UNIQUE_VIOLATION = "23505";
const PREVIEW_TOKEN_TTL_SECONDS = 60 * 60;
/** A verified domain stops routing after this many failed daily re-checks in a row. */
const CUSTOM_DOMAIN_MAX_FAILURES = 3;
const SUBDOMAIN_CHANGES_PER_DAY = 5;

export interface HelpCenterActor {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export type SubdomainAvailability =
  { available: true } | { available: false; reason: SubdomainProblem | "taken" };

export interface HelpCenterArticleView {
  documentId: string;
  title: string;
  status: string;
  visibility: string;
  /** Published and public: the only state in which the site shows it. */
  live: boolean;
  helpfulCount: number;
  unhelpfulCount: number;
}

export interface HelpCenterCollectionView {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  articles: HelpCenterArticleView[];
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === POSTGRES_UNIQUE_VIOLATION;
}

/** The stored theme with defaults filled in. */
export function resolveTheme(theme: Partial<HelpCenterTheme> | null | undefined): HelpCenterTheme {
  return { ...DEFAULT_HELP_CENTER_THEME, ...(theme ?? {}) };
}

/** The DNS records that prove control of a custom domain. Either one is enough. */
export function customDomainRecords(helpCenter: HelpCenter) {
  const target = customDomainTargetHostname(helpCenter);
  return {
    cname: { name: helpCenter.customDomain ?? "", value: target },
    txt: {
      name: `_hay-help-center.${helpCenter.customDomain ?? ""}`,
      value: `hay-help-center=${helpCenter.customDomainTarget}`,
    },
  };
}

function previewSignature(helpCenterId: string, expires: number): string {
  return crypto
    .createHmac("sha256", deriveServiceKey("hay:help-center-preview:v1"))
    .update(`${helpCenterId}.${expires}`)
    .digest("base64url");
}

/** A short-lived token that lets the dashboard preview a site, live or not. */
export function signPreviewToken(helpCenterId: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + PREVIEW_TOKEN_TTL_SECONDS;
  return `${expires}.${previewSignature(helpCenterId, expires)}`;
}

export function verifyPreviewToken(helpCenterId: string, token: unknown, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [expiresPart, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !signature || !/^\d{1,12}$/.test(expiresPart)) return false;
  const expires = Number(expiresPart);
  if (expires * 1000 < now) return false;
  const expected = Buffer.from(previewSignature(helpCenterId, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export class HelpCenterService {
  private get helpCenters() {
    return AppDataSource.getRepository(HelpCenter);
  }

  private get collections() {
    return AppDataSource.getRepository(HelpCenterCollection);
  }

  private assertEnabled(): void {
    if (!isHelpCenterEnabled()) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Help centers are not set up on this server (HELP_CENTER_DOMAIN is not set)",
      });
    }
  }

  findByOrganization(organizationId: string): Promise<HelpCenter | null> {
    return this.helpCenters.findOne({ where: { organizationId } });
  }

  private async require(organizationId: string): Promise<HelpCenter> {
    const helpCenter = await this.findByOrganization(organizationId);
    if (!helpCenter) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Create your help center first" });
    }
    return helpCenter;
  }

  /** What the dashboard shows for a help center. */
  view(helpCenter: HelpCenter) {
    return {
      id: helpCenter.id,
      name: helpCenter.name,
      subdomain: helpCenter.subdomain,
      defaultLanguage: helpCenter.defaultLanguage,
      isPublished: helpCenter.isPublished,
      searchIndexing: helpCenter.searchIndexing,
      theme: resolveTheme(helpCenter.theme),
      defaultUrl: defaultUrl(helpCenter),
      url: canonicalUrl(helpCenter),
      customDomain: helpCenter.customDomain
        ? {
            domain: helpCenter.customDomain,
            verified: !!helpCenter.customDomainVerifiedAt,
            verifiedAt: helpCenter.customDomainVerifiedAt ?? null,
            checkedAt: helpCenter.customDomainCheckedAt ?? null,
            records: customDomainRecords(helpCenter),
          }
        : null,
    };
  }

  async checkSubdomain(input: string, organizationId: string): Promise<SubdomainAvailability> {
    const subdomain = normalizeSubdomain(input);
    const problem = subdomainProblem(subdomain);
    if (problem) return { available: false, reason: problem };
    // The dashboard or API may itself live under the help center domain.
    if (isPlatformHostname(`${subdomain}.${helpCenterBaseHostname()}`)) {
      return { available: false, reason: "reserved" };
    }
    const existing = await this.helpCenters.findOne({ where: { subdomain } });
    if (existing && existing.organizationId !== organizationId) {
      return { available: false, reason: "taken" };
    }
    return { available: true };
  }

  private async assertSubdomainFree(input: string, organizationId: string): Promise<string> {
    const result = await this.checkSubdomain(input, organizationId);
    if (!result.available) {
      throw new TRPCError({
        code: result.reason === "taken" ? "CONFLICT" : "BAD_REQUEST",
        message:
          result.reason === "taken"
            ? "That address is already taken"
            : "Use 3 to 63 lowercase letters, numbers or hyphens for the address",
      });
    }
    return normalizeSubdomain(input);
  }

  /**
   * Each new address can cost the proxy a certificate, and certificate
   * authorities ration those per domain, so addresses cannot be cycled freely.
   */
  private async assertMayRename(organizationId: string): Promise<void> {
    const { limited } = await rateLimitService.checkKeyRateLimit(
      `help-center:rename:${organizationId}`,
      SUBDOMAIN_CHANGES_PER_DAY,
      24 * 60 * 60,
    );
    if (limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "The address was changed too many times today. Try again tomorrow.",
      });
    }
  }

  async create(
    organizationId: string,
    input: { name: string; subdomain: string; defaultLanguage: string },
    actor: HelpCenterActor,
  ): Promise<HelpCenter> {
    this.assertEnabled();
    if (await this.findByOrganization(organizationId)) {
      throw new TRPCError({ code: "CONFLICT", message: "This organization has a help center" });
    }
    const subdomain = await this.assertSubdomainFree(input.subdomain, organizationId);
    let helpCenter: HelpCenter;
    try {
      helpCenter = await this.helpCenters.save(
        this.helpCenters.create({
          organizationId,
          name: input.name,
          subdomain,
          defaultLanguage: input.defaultLanguage,
          theme: {},
          customDomainTarget: `${CUSTOM_DOMAIN_TARGET_PREFIX}${crypto.randomBytes(10).toString("hex")}`,
          createdBy: actor.userId,
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TRPCError({ code: "CONFLICT", message: "That address is already taken" });
      }
      throw error;
    }
    clearHelpCenterHostCache();
    await this.audit(actor, organizationId, "help_center.create", { subdomain });
    return helpCenter;
  }

  async update(
    organizationId: string,
    input: {
      name?: string;
      subdomain?: string;
      defaultLanguage?: string;
      searchIndexing?: boolean;
      theme?: Partial<HelpCenterTheme>;
    },
  ): Promise<HelpCenter> {
    const helpCenter = await this.require(organizationId);
    if (input.name !== undefined) helpCenter.name = input.name;
    if (input.defaultLanguage !== undefined) helpCenter.defaultLanguage = input.defaultLanguage;
    if (input.searchIndexing !== undefined) helpCenter.searchIndexing = input.searchIndexing;
    if (input.theme !== undefined) helpCenter.theme = { ...helpCenter.theme, ...input.theme };
    if (input.subdomain !== undefined) {
      const subdomain = await this.assertSubdomainFree(input.subdomain, organizationId);
      if (subdomain !== helpCenter.subdomain) {
        await this.assertMayRename(organizationId);
        helpCenter.subdomain = subdomain;
      }
    }
    try {
      await this.helpCenters.save(helpCenter);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TRPCError({ code: "CONFLICT", message: "That address is already taken" });
      }
      throw error;
    }
    clearHelpCenterHostCache();
    return helpCenter;
  }

  async setPublished(
    organizationId: string,
    published: boolean,
    actor: HelpCenterActor,
  ): Promise<HelpCenter> {
    const helpCenter = await this.require(organizationId);
    helpCenter.isPublished = published;
    await this.helpCenters.save(helpCenter);
    clearHelpCenterHostCache();
    await this.audit(
      actor,
      organizationId,
      published ? "help_center.publish" : "help_center.unpublish",
      { subdomain: helpCenter.subdomain },
    );
    return helpCenter;
  }

  // ---------------------------------------------------------------- collections

  async listCollections(organizationId: string): Promise<HelpCenterCollectionView[]> {
    const helpCenter = await this.findByOrganization(organizationId);
    if (!helpCenter) return [];
    const collections = await this.collections.find({
      where: { helpCenterId: helpCenter.id, organizationId },
      order: { position: "ASC", createdAt: "ASC" },
    });
    const rows: Array<{
      collection_id: string;
      document_id: string;
      title: string | null;
      status: string;
      visibility: string;
      helpful_count: number;
      unhelpful_count: number;
    }> = await AppDataSource.query(
      `SELECT a.collection_id, a.document_id, d.title, d.status, d.visibility,
              a.helpful_count, a.unhelpful_count
         FROM help_center_articles a
         JOIN documents d ON d.id = a.document_id
        WHERE a.organization_id = $1
        ORDER BY a.position ASC, a.created_at ASC`,
      [organizationId],
    );
    return collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      description: collection.description ?? null,
      icon: collection.icon ?? null,
      articles: rows
        .filter((row) => row.collection_id === collection.id)
        .map((row) => ({
          documentId: row.document_id,
          title: row.title ?? "",
          status: row.status,
          visibility: row.visibility,
          live: row.status === "published" && row.visibility === "public",
          helpfulCount: row.helpful_count,
          unhelpfulCount: row.unhelpful_count,
        })),
    }));
  }

  async createCollection(
    organizationId: string,
    input: { title: string; description?: string | null; icon?: string | null },
  ): Promise<HelpCenterCollection> {
    const helpCenter = await this.require(organizationId);
    const last = await this.collections.findOne({
      where: { helpCenterId: helpCenter.id },
      order: { position: "DESC" },
    });
    return this.collections.save(
      this.collections.create({
        organizationId,
        helpCenterId: helpCenter.id,
        title: input.title,
        description: input.description ?? null,
        icon: input.icon ?? null,
        position: (last?.position ?? -1) + 1,
      }),
    );
  }

  private async requireCollection(organizationId: string, id: string) {
    const collection = await this.collections.findOne({ where: { id, organizationId } });
    if (!collection) throw new TRPCError({ code: "NOT_FOUND", message: "Collection not found" });
    return collection;
  }

  async updateCollection(
    organizationId: string,
    id: string,
    input: { title?: string; description?: string | null; icon?: string | null },
  ): Promise<HelpCenterCollection> {
    const collection = await this.requireCollection(organizationId, id);
    if (input.title !== undefined) collection.title = input.title;
    if (input.description !== undefined) collection.description = input.description;
    if (input.icon !== undefined) collection.icon = input.icon;
    return this.collections.save(collection);
  }

  async deleteCollection(organizationId: string, id: string): Promise<void> {
    await this.collections.delete({ id, organizationId });
  }

  /** Put the collections in the given order. Ids of other organizations are ignored. */
  async reorderCollections(organizationId: string, ids: string[]): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      for (const [position, id] of ids.entries()) {
        await manager.update(HelpCenterCollection, { id, organizationId }, { position });
      }
    });
  }

  /**
   * Set the articles of a collection, in order. A document already in another
   * collection moves here. Every listed document becomes public: that is what
   * putting it on the help center means, and the dashboard says so first.
   */
  async setCollectionArticles(
    organizationId: string,
    collectionId: string,
    documentIds: string[],
  ): Promise<void> {
    await this.requireCollection(organizationId, collectionId);
    const ids = [...new Set(documentIds)];
    if (ids.length > 0) {
      const owned = await AppDataSource.getRepository(Document).count({
        where: { id: In(ids), organizationId },
      });
      if (owned !== ids.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }
    }

    await AppDataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM help_center_articles
          WHERE organization_id = $1 AND collection_id = $2 AND NOT (document_id = ANY($3::uuid[]))`,
        [organizationId, collectionId, ids],
      );
      for (const [position, documentId] of ids.entries()) {
        await manager.query(
          `INSERT INTO help_center_articles (organization_id, collection_id, document_id, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (document_id)
           DO UPDATE SET collection_id = EXCLUDED.collection_id, position = EXCLUDED.position, updated_at = now()`,
          [organizationId, collectionId, documentId, position],
        );
      }
      if (ids.length > 0) {
        await manager.update(
          Document,
          { id: In(ids), organizationId, visibility: Not(DocumentVisibility.PUBLIC) },
          { visibility: DocumentVisibility.PUBLIC },
        );
      }
    });
  }

  // -------------------------------------------------------------- custom domain

  async setCustomDomain(organizationId: string, rawDomain: string, actor: HelpCenterActor) {
    this.assertEnabled();
    const helpCenter = await this.require(organizationId);
    const domain = normalizeDomain(rawDomain);
    const base = helpCenterBaseHostname();
    if (domain === base || domain.endsWith(`.${base}`) || isPlatformHostname(domain)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Use a domain you own, such as help.yourcompany.com",
      });
    }
    if (helpCenter.customDomain !== domain) {
      helpCenter.customDomain = domain;
      helpCenter.customDomainVerifiedAt = null;
      helpCenter.customDomainCheckedAt = null;
      helpCenter.customDomainFailures = 0;
      await this.helpCenters.save(helpCenter);
      clearHelpCenterHostCache();
      await this.audit(actor, organizationId, "help_center.domain.set", { domain });
    }
    return helpCenter;
  }

  /** True when the domain's DNS shows this help center's CNAME target or TXT value right now. */
  private async domainProvesControl(helpCenter: HelpCenter): Promise<boolean> {
    const records = customDomainRecords(helpCenter);
    const cnames = await dns.resolveCname(records.cname.name).catch(() => [] as string[]);
    if (cnames.some((name) => name.toLowerCase().replace(/\.$/, "") === records.cname.value)) {
      return true;
    }
    const txt = await dns.resolveTxt(records.txt.name).catch(() => [] as string[][]);
    return txt.some((chunks) => chunks.join("") === records.txt.value);
  }

  /** Looks for the DNS record. Only a record seen now counts; nothing is assumed. */
  async verifyCustomDomain(organizationId: string, actor: HelpCenterActor): Promise<HelpCenter> {
    const helpCenter = await this.require(organizationId);
    if (!helpCenter.customDomain) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Add a domain first" });
    }
    if (helpCenter.customDomainVerifiedAt) return helpCenter;

    // The DNS lookups below take a while. Everything written afterwards names the domain it
    // was checked for and only the check's own columns, so a change made meanwhile (going
    // offline, removing the domain) is never overwritten with what was loaded before.
    const domain = helpCenter.customDomain;
    const checked = { id: helpCenter.id, customDomain: domain };
    helpCenter.customDomainCheckedAt = new Date();
    if (!(await this.domainProvesControl(helpCenter))) {
      await this.helpCenters.update(checked, {
        customDomainCheckedAt: helpCenter.customDomainCheckedAt,
      });
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "We did not find the DNS record yet. Add the record shown, then try again (DNS changes can take a while).",
      });
    }

    try {
      await this.helpCenters.update(checked, {
        customDomainCheckedAt: helpCenter.customDomainCheckedAt,
        customDomainVerifiedAt: new Date(),
        customDomainFailures: 0,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another help center already uses this domain",
        });
      }
      throw error;
    }
    clearHelpCenterHostCache();
    const verified = await this.require(organizationId);
    if (verified.customDomain === domain && verified.customDomainVerifiedAt) {
      await this.audit(actor, organizationId, "help_center.domain.verify", { domain });
    }
    return verified;
  }

  async removeCustomDomain(organizationId: string, actor: HelpCenterActor): Promise<HelpCenter> {
    const helpCenter = await this.require(organizationId);
    if (!helpCenter.customDomain) return helpCenter;
    const domain = helpCenter.customDomain;
    helpCenter.customDomain = null;
    helpCenter.customDomainVerifiedAt = null;
    helpCenter.customDomainCheckedAt = null;
    helpCenter.customDomainFailures = 0;
    await this.helpCenters.save(helpCenter);
    clearHelpCenterHostCache();
    await this.audit(actor, organizationId, "help_center.domain.remove", { domain });
    return helpCenter;
  }

  /**
   * Daily job: confirm every verified domain still points here. A domain that
   * fails several days in a row stops routing, so one that moved away (or
   * whose DNS was taken over) is not served forever on an old proof.
   */
  async recheckCustomDomains(): Promise<void> {
    const verified = await this.helpCenters.find({
      where: { customDomainVerifiedAt: Not(IsNull()) },
    });
    for (const helpCenter of verified) {
      const stillValid = await this.domainProvesControl(helpCenter);
      const failures = stillValid ? 0 : helpCenter.customDomainFailures + 1;
      const lapsed = failures >= CUSTOM_DOMAIN_MAX_FAILURES;
      if (lapsed) {
        logger.warn(
          { helpCenterId: helpCenter.id, domain: helpCenter.customDomain },
          "Custom domain no longer points at this help center; it has stopped routing",
        );
      }
      // Only the check's own columns, and only if the domain is still the one checked
      // (see verifyCustomDomain).
      await this.helpCenters.update(
        { id: helpCenter.id, customDomain: helpCenter.customDomain ?? undefined },
        {
          customDomainCheckedAt: new Date(),
          customDomainFailures: failures,
          ...(lapsed && { customDomainVerifiedAt: null }),
        },
      );
    }
    clearHelpCenterHostCache();
  }

  private audit(
    actor: HelpCenterActor,
    organizationId: string,
    action:
      | "help_center.create"
      | "help_center.publish"
      | "help_center.unpublish"
      | "help_center.domain.set"
      | "help_center.domain.verify"
      | "help_center.domain.remove",
    changes: Record<string, unknown>,
  ): Promise<void> {
    return auditLogService.record({
      userId: actor.userId,
      organizationId,
      action,
      resource: "help_center",
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}

export const helpCenterService = new HelpCenterService();
