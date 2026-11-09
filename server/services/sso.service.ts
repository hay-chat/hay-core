import * as crypto from "crypto";
import dns from "dns/promises";
import { TRPCError } from "@trpc/server";
import { QueryFailedError } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import {
  SSO_ASSIGNABLE_ROLES,
  SsoConnection,
  type SsoAssignableRole,
} from "@server/database/entities/sso-connection.entity";
import { SsoDomain } from "@server/database/entities/sso-domain.entity";
import { SsoIdentity } from "@server/database/entities/sso-identity.entity";
import { Organization } from "@server/entities/organization.entity";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { getApiUrl } from "@server/config/env";
import { hashPassword } from "@server/lib/auth/utils/hashing";
import { decryptValue, encryptValue } from "@server/lib/auth/utils/encryption";
import {
  OidcError,
  assertAcceptableProviderUrl,
  buildAuthorizationUrl,
  claimValues,
  discoverProvider,
  exchangeCode,
  normalizeIssuer,
  randomToken,
  verifiedEmail,
  verifyIdToken,
  type IdTokenClaims,
} from "@server/lib/auth/sso/oidc";
import { createLogger } from "@server/lib/logger";
import { auditLogService } from "@server/services/audit-log.service";
import { mfaService } from "@server/services/mfa.service";
import { redisService } from "@server/services/redis.service";

const logger = createLogger("sso");

const STATE_TTL_SECONDS = 10 * 60;
const TICKET_TTL_SECONDS = 60;
const POSTGRES_UNDEFINED_TABLE = "42P01";
const POSTGRES_UNIQUE_VIOLATION = "23505";
/** First match wins when a person's groups map to several roles. */
const ROLE_PRECEDENCE: SsoAssignableRole[] = ["admin", "member", "contributor", "agent", "viewer"];

const DOMAIN_PATTERN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const SSO_BINDING_COOKIE = "hay_sso_binding";

/** Why a sign-in was refused. The browser only ever sees the code. */
export type SsoFailureCode =
  | "unavailable"
  | "state_invalid"
  | "provider_error"
  | "token_invalid"
  | "domain_unverified"
  | "email_unverified"
  | "account_conflict"
  | "not_member"
  | "account_disabled";

export class SsoLoginError extends Error {
  constructor(
    public readonly code: SsoFailureCode,
    message: string,
    public readonly organizationId?: string,
  ) {
    super(message);
    this.name = "SsoLoginError";
  }
}

interface LoginState {
  connectionId: string;
  organizationId: string;
  issuer: string;
  clientId: string;
  nonce: string;
  codeVerifier: string;
  /** sha256 of the cookie set on the browser that started the sign-in. */
  bindingHash: string;
}

interface LoginTicket {
  userId: string;
  organizationId: string;
}

export interface SsoActor {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SsoConnectionInput {
  issuer: string;
  clientId: string;
  /** Required when creating; omitted to keep the stored secret. */
  clientSecret?: string;
  defaultRole: SsoAssignableRole;
  roleClaim?: string | null;
  roleMapping: Record<string, SsoAssignableRole>;
  enabled: boolean;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPgError(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === code
  );
}

function requireRedis() {
  const client = redisService.isConnected() ? redisService.getClient() : null;
  if (!client) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Single sign-on is unavailable right now",
    });
  }
  return client;
}

export function ssoRedirectUri(): string {
  return `${getApiUrl()}/sso/callback`;
}

export function normalizeDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a domain like example.com" });
  }
  return domain;
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1
    ? email
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : null;
}

/** The TXT record an owner publishes to prove they control a domain. */
export function domainChallenge(domain: SsoDomain): { name: string; value: string } {
  return {
    name: `_hay-sso-challenge.${domain.domain}`,
    value: `hay-sso-verification=${domain.verificationToken}`,
  };
}

/** Role for a sign-in: the best mapping among the person's claim values, else the default. */
export function resolveRole(connection: SsoConnection, claims: IdTokenClaims): SsoAssignableRole {
  if (!connection.roleClaim) return connection.defaultRole;
  const mapped = new Set<SsoAssignableRole>();
  for (const value of claimValues(claims, connection.roleClaim)) {
    if (!Object.prototype.hasOwnProperty.call(connection.roleMapping, value)) continue;
    const role = connection.roleMapping[value];
    // Whatever is stored, only these roles can come from a claim; never the owner.
    if ((SSO_ASSIGNABLE_ROLES as readonly string[]).includes(role)) mapped.add(role);
  }
  return ROLE_PRECEDENCE.find((role) => mapped.has(role)) ?? connection.defaultRole;
}

export class SsoService {
  private get connections() {
    return AppDataSource.getRepository(SsoConnection);
  }
  private get domains() {
    return AppDataSource.getRepository(SsoDomain);
  }

  // ---- Configuration (organization owners) ----

  async getConnection(organizationId: string) {
    const connection = await this.connections.findOne({ where: { organizationId } });
    if (!connection) return null;
    const { clientSecret: _secret, ...rest } = connection;
    return { ...rest, hasClientSecret: true as const, redirectUri: ssoRedirectUri() };
  }

  async saveConnection(organizationId: string, input: SsoConnectionInput, actor: SsoActor) {
    const issuer = normalizeIssuer(input.issuer);
    assertAcceptableProviderUrl(issuer);
    const existing = await this.connections.findOne({ where: { organizationId } });
    if (!existing && !input.clientSecret) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A client secret is required" });
    }

    // A provider that cannot be reached or that names another issuer is refused now,
    // not discovered by the first person who tries to sign in.
    try {
      await discoverProvider(issuer);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          error instanceof OidcError
            ? `The provider could not be verified: ${error.message}`
            : "The provider could not be verified",
      });
    }

    const credentialsChanged =
      !existing ||
      existing.issuer !== issuer ||
      existing.clientId !== input.clientId ||
      (input.clientSecret !== undefined &&
        input.clientSecret !== decryptValue(existing.clientSecret));

    const connection = existing ?? this.connections.create({ organizationId });
    connection.issuer = issuer;
    connection.clientId = input.clientId;
    if (input.clientSecret) connection.clientSecret = encryptValue(input.clientSecret);
    connection.defaultRole = input.defaultRole;
    connection.roleClaim = input.roleClaim || null;
    connection.roleMapping = input.roleMapping;
    connection.enabled = input.enabled;
    // A changed provider has not yet proven it can sign anyone in.
    if (credentialsChanged) connection.lastLoginAt = null;
    connection.updatedBy = actor.userId;
    await this.connections.save(connection);

    // Editing the provider must never leave the organization enforcing a login that may not work.
    const liftEnforcement =
      (credentialsChanged || !input.enabled) && (await this.isEnforced(organizationId));
    if (liftEnforcement) await this.writeEnforcement(organizationId, false);

    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.config.update",
      resource: "sso_connection",
      changes: {
        issuer,
        clientId: input.clientId,
        defaultRole: input.defaultRole,
        roleClaim: connection.roleClaim,
        enabled: input.enabled,
        clientSecretChanged: !!input.clientSecret,
        enforcementLifted: liftEnforcement,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return this.getConnection(organizationId);
  }

  async deleteConnection(organizationId: string, actor: SsoActor): Promise<void> {
    const result = await this.connections.delete({ organizationId });
    if (!result.affected) return;
    const wasEnforced = await this.isEnforced(organizationId);
    if (wasEnforced) await this.writeEnforcement(organizationId, false);
    await AppDataSource.getRepository(SsoIdentity).delete({ organizationId });
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.config.delete",
      resource: "sso_connection",
      changes: { enforcementLifted: wasEnforced },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  private async isEnforced(organizationId: string): Promise<boolean> {
    const organization = await AppDataSource.getRepository(Organization).findOne({
      where: { id: organizationId },
      select: { id: true, settings: true },
    });
    return organization?.settings?.ssoEnforced === true;
  }

  private async writeEnforcement(organizationId: string, enforced: boolean): Promise<void> {
    await AppDataSource.query(
      `UPDATE organizations
          SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ssoEnforced}', to_jsonb($2::boolean))
        WHERE id = $1`,
      [organizationId, enforced],
    );
  }

  /**
   * Turning enforcement on needs a provider that has signed someone in, a
   * verified domain, and an owner who can still get in with a password and a
   * second factor if the provider fails. That owner is the person asking.
   */
  async setEnforcement(
    organizationId: string,
    enforced: boolean,
    actor: SsoActor & { role: string },
  ): Promise<void> {
    if (enforced) {
      const connection = await this.connections.findOne({ where: { organizationId } });
      if (!connection?.enabled || !connection.lastLoginAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Sign in once through the identity provider before requiring it",
        });
      }
      const verified = await this.domains
        .createQueryBuilder("domain")
        .where("domain.organization_id = :organizationId", { organizationId })
        .andWhere("domain.verified_at IS NOT NULL")
        .getCount();
      if (verified === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Verify at least one email domain before requiring single sign-on",
        });
      }
      if (actor.role !== "owner" || !(await mfaService.hasSecondFactor(actor.userId))) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Set up two-factor authentication on your own account first: as an owner you stay able to sign in with a password if the identity provider fails",
        });
      }
    }
    await this.writeEnforcement(organizationId, enforced);
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.enforcement.change",
      resource: "organization",
      changes: { ssoEnforced: enforced },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // ---- Domains ----

  async listDomains(organizationId: string) {
    const rows = await this.domains.find({
      where: { organizationId },
      order: { createdAt: "ASC" },
    });
    return rows.map((row) => ({
      id: row.id,
      domain: row.domain,
      verified: !!row.verifiedAt,
      verifiedAt: row.verifiedAt ?? null,
      challenge: row.verifiedAt ? null : domainChallenge(row),
    }));
  }

  async addDomain(organizationId: string, rawDomain: string, actor: SsoActor) {
    const domain = normalizeDomain(rawDomain);
    const existing = await this.domains.findOne({ where: { organizationId, domain } });
    if (existing) return existing;
    const row = await this.domains.save(
      this.domains.create({
        organizationId,
        domain,
        verificationToken: crypto.randomBytes(24).toString("hex"),
        createdBy: actor.userId,
      }),
    );
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.domain.add",
      resource: "sso_domain",
      changes: { domain },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return row;
  }

  /** Looks for the TXT record. Only a record seen now counts; nothing is assumed. */
  async verifyDomain(organizationId: string, domainId: string, actor: SsoActor) {
    const row = await this.domains.findOne({ where: { id: domainId, organizationId } });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" });
    if (row.verifiedAt) return row;

    const challenge = domainChallenge(row);
    let records: string[][] = [];
    try {
      records = await dns.resolveTxt(challenge.name);
    } catch {
      records = [];
    }
    const found = records.some((chunks) => chunks.join("") === challenge.value);
    if (!found) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `We did not find the TXT record yet. Publish ${challenge.name} with the value shown, then try again (DNS changes can take a while).`,
      });
    }

    row.verifiedAt = new Date();
    try {
      await this.domains.save(row);
    } catch (error) {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Another organization has already verified this domain",
        });
      }
      throw error;
    }
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.domain.verify",
      resource: "sso_domain",
      changes: { domain: row.domain },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return row;
  }

  async removeDomain(organizationId: string, domainId: string, actor: SsoActor): Promise<void> {
    const row = await this.domains.findOne({ where: { id: domainId, organizationId } });
    if (!row) return;
    await this.domains.delete({ id: row.id });
    if (row.verifiedAt && (await this.isEnforced(organizationId))) {
      const remaining = await this.domains
        .createQueryBuilder("domain")
        .where("domain.organization_id = :organizationId", { organizationId })
        .andWhere("domain.verified_at IS NOT NULL")
        .getCount();
      if (remaining === 0) await this.writeEnforcement(organizationId, false);
    }
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "sso.domain.remove",
      resource: "sso_domain",
      changes: { domain: row.domain },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // ---- Sign-in ----

  /**
   * The enabled connection that serves this email address, found only through a
   * domain that was proven by DNS. An unverified claim never selects a tenant.
   */
  async findConnectionForEmail(email: string): Promise<SsoConnection | null> {
    const domain = emailDomain(email);
    if (!domain) return null;
    try {
      const row = await this.domains
        .createQueryBuilder("domain")
        .where("domain.domain = :domain", { domain })
        .andWhere("domain.verified_at IS NOT NULL")
        .getOne();
      if (!row) return null;
      const connection = await this.connections.findOne({
        where: { organizationId: row.organizationId, enabled: true },
      });
      return connection ?? null;
    } catch (error) {
      // Migrations run after deploy; until then nobody has SSO.
      if (isPgError(error, POSTGRES_UNDEFINED_TABLE)) return null;
      throw error;
    }
  }

  /** The URL to send the browser to, and the secret for the cookie that ties the sign-in to it. */
  async beginLogin(email: string): Promise<{ url: string; binding: string }> {
    const connection = await this.findConnectionForEmail(email);
    if (!connection)
      throw new SsoLoginError("unavailable", "No identity provider for this address");

    const redis = requireRedis();
    const provider = await this.discover(connection);
    const state = randomToken();
    const binding = randomToken();
    const loginState: LoginState = {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      issuer: connection.issuer,
      clientId: connection.clientId,
      nonce: randomToken(),
      codeVerifier: randomToken(48),
      bindingHash: sha256(binding),
    };
    await redis.set(
      `sso:state:${sha256(state)}`,
      JSON.stringify(loginState),
      "EX",
      STATE_TTL_SECONDS,
    );
    return {
      binding,
      url: buildAuthorizationUrl({
        provider,
        clientId: connection.clientId,
        redirectUri: ssoRedirectUri(),
        state,
        nonce: loginState.nonce,
        codeVerifier: loginState.codeVerifier,
        loginHint: email,
      }),
    };
  }

  private async discover(connection: SsoConnection) {
    try {
      return await discoverProvider(connection.issuer);
    } catch (error) {
      logger.warn(
        { err: error, organizationId: connection.organizationId },
        "SSO discovery failed",
      );
      throw new SsoLoginError(
        "provider_error",
        "The identity provider could not be reached",
        connection.organizationId,
      );
    }
  }

  /**
   * Finish a sign-in the provider sent back to us. The state is spent on first
   * use, whatever happens next. Returns a one-minute ticket the dashboard trades
   * for a session.
   */
  async handleCallback(params: {
    code: string;
    state: string;
    binding: string | undefined;
  }): Promise<string> {
    const redis = requireRedis();
    const raw = await redis.getdel(`sso:state:${sha256(params.state)}`);
    if (!raw) throw new SsoLoginError("state_invalid", "Unknown or already used state");
    const state = JSON.parse(raw) as LoginState;

    const expected = Buffer.from(state.bindingHash);
    const given = Buffer.from(sha256(params.binding ?? ""));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      throw new SsoLoginError(
        "state_invalid",
        "Sign-in did not start in this browser",
        state.organizationId,
      );
    }

    const connection = await this.connections.findOne({ where: { id: state.connectionId } });
    if (
      !connection?.enabled ||
      connection.issuer !== state.issuer ||
      connection.clientId !== state.clientId
    ) {
      throw new SsoLoginError(
        "unavailable",
        "The connection changed during sign-in",
        state.organizationId,
      );
    }

    const provider = await this.discover(connection);
    let claims: IdTokenClaims;
    try {
      const idToken = await exchangeCode({
        provider,
        clientId: connection.clientId,
        clientSecret: decryptValue(connection.clientSecret),
        redirectUri: ssoRedirectUri(),
        code: params.code,
        codeVerifier: state.codeVerifier,
      });
      claims = await verifyIdToken({
        idToken,
        provider,
        clientId: connection.clientId,
        nonce: state.nonce,
      });
    } catch (error) {
      if (error instanceof OidcError) {
        logger.warn(
          { organizationId: connection.organizationId, reason: error.code },
          "SSO token refused",
        );
        throw new SsoLoginError(
          error.code === "token_exchange_failed" ? "provider_error" : "token_invalid",
          error.message,
          connection.organizationId,
        );
      }
      throw error;
    }

    const user = await this.provision(connection, claims);
    const ticket = randomToken();
    const payload: LoginTicket = { userId: user.id, organizationId: connection.organizationId };
    await redis.set(
      `sso:ticket:${sha256(ticket)}`,
      JSON.stringify(payload),
      "EX",
      TICKET_TTL_SECONDS,
    );
    return ticket;
  }

  /** Spends a ticket. The person must still be active and a member when it is redeemed. */
  async redeemTicket(ticket: string): Promise<{ user: User; organizationId: string }> {
    const raw = await requireRedis().getdel(`sso:ticket:${sha256(ticket)}`);
    if (!raw) throw new SsoLoginError("state_invalid", "Unknown or already used sign-in");
    const payload = JSON.parse(raw) as LoginTicket;

    const user = await AppDataSource.getRepository(User).findOne({ where: { id: payload.userId } });
    const membership = await AppDataSource.getRepository(UserOrganization).findOne({
      where: { userId: payload.userId, organizationId: payload.organizationId, isActive: true },
    });
    if (!user?.isActive || !user.emailVerified || !membership) {
      throw new SsoLoginError("account_disabled", "Account is not active", payload.organizationId);
    }
    return { user, organizationId: payload.organizationId };
  }

  /**
   * Find or create the person this ID token describes, inside this organization only.
   *
   * - The token's email must be verified by the provider and sit on a domain this
   *   organization proved with DNS.
   * - A returning person is matched on the provider's stable subject id.
   * - A first sign-in matches an existing account by email only when that account
   *   is already a member of this organization. An account that exists elsewhere is
   *   never claimed, whatever the provider says.
   */
  private async provision(connection: SsoConnection, claims: IdTokenClaims): Promise<User> {
    const organizationId = connection.organizationId;
    let email: string;
    try {
      email = verifiedEmail(claims);
    } catch (error) {
      throw new SsoLoginError("email_unverified", (error as Error).message, organizationId);
    }
    const domain = emailDomain(email);
    const proven = domain
      ? await this.domains
          .createQueryBuilder("domain")
          .where("domain.organization_id = :organizationId", { organizationId })
          .andWhere("domain.domain = :domain", { domain })
          .andWhere("domain.verified_at IS NOT NULL")
          .getCount()
      : 0;
    if (proven === 0) {
      throw new SsoLoginError(
        "domain_unverified",
        "Email domain is not verified for this organization",
        organizationId,
      );
    }

    const role = resolveRole(connection, claims);
    const user = await AppDataSource.transaction(async (manager) => {
      const identities = manager.getRepository(SsoIdentity);
      const memberships = manager.getRepository(UserOrganization);
      const users = manager.getRepository(User);

      const identity = await identities.findOne({
        where: { organizationId, issuer: connection.issuer, subject: claims.sub },
      });
      let account: User | null;
      if (identity) {
        account = await users.findOne({ where: { id: identity.userId } });
      } else {
        account = await users.findOne({ where: { email } });
        if (account) {
          const member = await memberships.findOne({
            where: { userId: account.id, organizationId, isActive: true },
          });
          if (!member) {
            throw new SsoLoginError(
              "account_conflict",
              "This address belongs to an account outside the organization",
              organizationId,
            );
          }
          if (!account.emailVerified) {
            throw new SsoLoginError(
              "account_conflict",
              "This account has not verified its email address",
              organizationId,
            );
          }
        }
      }

      if (account && (!account.isActive || account.deletedAt)) {
        throw new SsoLoginError("account_disabled", "Account is deactivated", organizationId);
      }

      let membership: UserOrganization | null = null;
      if (account) {
        membership = await memberships.findOne({ where: { userId: account.id, organizationId } });
        if (!membership?.isActive) {
          // Removed members stay removed; signing in does not add them back.
          throw new SsoLoginError(
            "not_member",
            "No active membership in this organization",
            organizationId,
          );
        }
      } else {
        account = await users.save(
          users.create({
            email,
            // Nobody knows this password; the person signs in through the provider.
            password: await hashPassword(crypto.randomBytes(32).toString("base64url")),
            firstName:
              typeof claims.given_name === "string" ? claims.given_name.slice(0, 255) : undefined,
            lastName:
              typeof claims.family_name === "string" ? claims.family_name.slice(0, 255) : undefined,
            isActive: true,
            emailVerified: true,
            organizationId,
            role,
          }),
        );
        membership = await memberships.save(
          memberships.create({
            userId: account.id,
            organizationId,
            role,
            isActive: true,
            joinedAt: new Date(),
          }),
        );
      }

      // The provider owns roles once a claim is configured, except that it can never touch an owner.
      if (connection.roleClaim && membership.role !== "owner" && membership.role !== role) {
        membership.role = role;
        await memberships.save(membership);
      }

      if (!identity) {
        await identities.save(
          identities.create({
            organizationId,
            userId: account.id,
            issuer: connection.issuer,
            subject: claims.sub,
            lastLoginAt: new Date(),
          }),
        );
      } else {
        identity.lastLoginAt = new Date();
        await identities.save(identity);
      }
      await manager
        .getRepository(SsoConnection)
        .update({ id: connection.id }, { lastLoginAt: new Date() });
      return account;
    }).catch((error: unknown) => {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new SsoLoginError(
          "account_conflict",
          "This identity is already linked to another account",
          organizationId,
        );
      }
      throw error;
    });
    return user;
  }
}

export const ssoService = new SsoService();
