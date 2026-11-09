import * as crypto from "crypto";
import { QueryFailedError, type EntityManager } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { ScimGroup } from "@server/database/entities/scim-group.entity";
import { ScimGroupMember } from "@server/database/entities/scim-group-member.entity";
import { ScimToken } from "@server/database/entities/scim-token.entity";
import { ScimUser } from "@server/database/entities/scim-user.entity";
import {
  SSO_ASSIGNABLE_ROLES,
  SsoConnection,
  type SsoAssignableRole,
} from "@server/database/entities/sso-connection.entity";
import { SsoDomain } from "@server/database/entities/sso-domain.entity";
import { SsoIdentity } from "@server/database/entities/sso-identity.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import { getApiUrl } from "@server/config/env";
import { hashPassword } from "@server/lib/auth/utils/hashing";
import { compileFilter, type FilterColumn } from "@server/lib/scim/filter";
import { ScimError } from "@server/lib/scim/errors";
import type { UserInput } from "@server/lib/scim/patch";
import { createLogger } from "@server/lib/logger";
import { auditLogService } from "@server/services/audit-log.service";
import { websocketService } from "@server/services/websocket.service";

const logger = createLogger("scim");

const POSTGRES_UNDEFINED_TABLE = "42P01";
const POSTGRES_UNIQUE_VIOLATION = "23505";
const TOKEN_PREFIX = "hay_scim_";
const LAST_USED_RESOLUTION_MS = 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** First match wins when a person's groups map to several roles; same order as sign-in. */
const ROLE_PRECEDENCE: SsoAssignableRole[] = ["admin", "member", "contributor", "agent", "viewer"];

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_MAX_PAGE = 200;

function isPgError(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === code
  );
}

export function scimBaseUrl(): string {
  return `${getApiUrl()}/scim/v2`;
}

/** Who a SCIM request acts as, for the audit log. */
export interface ScimActor {
  organizationId: string;
  tokenId: string;
  ipAddress?: string;
  userAgent?: string;
}

export type UserChanges = UserInput;

export interface ScimPage {
  startIndex: number;
  count: number;
  filter?: string;
}

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  account_active: boolean;
  member_active: boolean;
  role: string;
  created_at: Date;
  updated_at: Date;
  external_id: string | null;
}

const USER_SELECT = `
  SELECT u.id, u.email, u.first_name, u.last_name, u.is_active AS account_active,
         uo.is_active AS member_active, uo.role, uo.created_at, uo.updated_at, su.external_id
    FROM user_organizations uo
    JOIN users u ON u.id = uo.user_id AND u.deleted_at IS NULL
    LEFT JOIN scim_users su ON su.user_id = u.id AND su.organization_id = uo.organization_id
   WHERE uo.organization_id = $1`;

const USER_COLUMNS: Record<string, FilterColumn> = {
  id: { sql: "u.id::text", type: "string" },
  userName: { sql: "u.email", type: "string" },
  externalId: { sql: "su.external_id", type: "string" },
  "emails.value": { sql: "u.email", type: "string" },
  emails: { sql: "u.email", type: "string" },
  active: { sql: "(uo.is_active AND u.is_active)", type: "boolean" },
  "name.givenName": { sql: "u.first_name", type: "string" },
  "name.familyName": { sql: "u.last_name", type: "string" },
  displayName: { sql: "trim(concat_ws(' ', u.first_name, u.last_name))", type: "string" },
};

const GROUP_COLUMNS: Record<string, FilterColumn> = {
  id: { sql: "g.id::text", type: "string" },
  displayName: { sql: "g.display_name", type: "string" },
  externalId: { sql: "g.external_id", type: "string" },
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function emailDomainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** The role a set of group names gives, or null when none of them is mapped. Never owner. */
export function roleForGroups(
  roleMapping: Record<string, SsoAssignableRole>,
  groupNames: string[],
): SsoAssignableRole | null {
  const mapped = new Set<SsoAssignableRole>();
  for (const name of groupNames) {
    if (!Object.prototype.hasOwnProperty.call(roleMapping, name)) continue;
    const role = roleMapping[name];
    if ((SSO_ASSIGNABLE_ROLES as readonly string[]).includes(role)) mapped.add(role);
  }
  return ROLE_PRECEDENCE.find((role) => mapped.has(role)) ?? null;
}

export class ScimService {
  // ---- Tokens (organization owners) ----

  async getTokenStatus(organizationId: string) {
    try {
      const token = await AppDataSource.getRepository(ScimToken).findOne({
        where: { organizationId },
      });
      return token
        ? {
            prefix: token.tokenPrefix,
            createdAt: token.createdAt,
            lastUsedAt: token.lastUsedAt ?? null,
          }
        : null;
    } catch (error) {
      // Migrations run after deploy; until then nobody has SCIM.
      if (isPgError(error, POSTGRES_UNDEFINED_TABLE)) return null;
      throw error;
    }
  }

  /** Creates the organization's token, replacing any earlier one. The value is returned once and never stored. */
  async createToken(
    organizationId: string,
    actor: { userId: string; ipAddress?: string; userAgent?: string },
  ) {
    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
    const repository = AppDataSource.getRepository(ScimToken);
    const existing = await repository.findOne({ where: { organizationId } });
    const row = existing ?? repository.create({ organizationId });
    row.tokenHash = sha256(token);
    row.tokenPrefix = token.slice(0, TOKEN_PREFIX.length + 4);
    row.lastUsedAt = null;
    row.createdBy = actor.userId;
    await repository.save(row);
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "scim.token.create",
      resource: "scim_token",
      changes: { replacedExisting: !!existing, prefix: row.tokenPrefix },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { token, prefix: row.tokenPrefix };
  }

  async revokeToken(
    organizationId: string,
    actor: { userId: string; ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const result = await AppDataSource.getRepository(ScimToken).delete({ organizationId });
    if (!result.affected) return;
    await auditLogService.record({
      userId: actor.userId,
      organizationId,
      action: "scim.token.revoke",
      resource: "scim_token",
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  /** The organization a bearer token belongs to, or null. */
  async authenticate(token: string): Promise<{ organizationId: string; tokenId: string } | null> {
    if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    try {
      const row = await AppDataSource.getRepository(ScimToken).findOne({
        where: { tokenHash: sha256(token) },
        relations: ["organization"],
      });
      if (!row) return null;
      // The same rule as API tokens: a deactivated or suspended organization is out of reach.
      if (!row.organization?.isActive || row.organization.suspendedAt) return null;
      const stale =
        !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS;
      if (stale) {
        await AppDataSource.getRepository(ScimToken).update(
          { id: row.id },
          { lastUsedAt: new Date() },
        );
      }
      return { organizationId: row.organizationId, tokenId: row.id };
    } catch (error) {
      if (isPgError(error, POSTGRES_UNDEFINED_TABLE)) return null;
      throw error;
    }
  }

  // ---- Resources ----

  private userResource(row: UserRow, groups: Array<{ id: string; displayName: string }> = []) {
    const name = {
      ...(row.first_name ? { givenName: row.first_name } : {}),
      ...(row.last_name ? { familyName: row.last_name } : {}),
      formatted: [row.first_name, row.last_name].filter(Boolean).join(" "),
    };
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: row.id,
      ...(row.external_id ? { externalId: row.external_id } : {}),
      userName: row.email,
      name,
      displayName: name.formatted || row.email,
      emails: [{ value: row.email, primary: true, type: "work" }],
      active: row.member_active && row.account_active,
      groups: groups.map((group) => ({
        value: group.id,
        display: group.displayName,
        $ref: `${scimBaseUrl()}/Groups/${group.id}`,
      })),
      meta: {
        resourceType: "User",
        created: row.created_at.toISOString(),
        lastModified: row.updated_at.toISOString(),
        location: `${scimBaseUrl()}/Users/${row.id}`,
      },
    };
  }

  private async groupsOf(organizationId: string, userIds: string[]) {
    const byUser = new Map<string, Array<{ id: string; displayName: string }>>();
    if (userIds.length === 0) return byUser;
    const rows: Array<{ user_id: string; id: string; display_name: string }> =
      await AppDataSource.query(
        `SELECT m.user_id, g.id, g.display_name
           FROM scim_group_members m JOIN scim_groups g ON g.id = m.group_id
          WHERE m.organization_id = $1 AND m.user_id = ANY($2::uuid[])
          ORDER BY g.display_name`,
        [organizationId, userIds],
      );
    for (const row of rows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push({ id: row.id, displayName: row.display_name });
      byUser.set(row.user_id, list);
    }
    return byUser;
  }

  private async loadUserRow(organizationId: string, userId: string): Promise<UserRow | null> {
    const rows: UserRow[] = await AppDataSource.query(`${USER_SELECT} AND u.id = $2`, [
      organizationId,
      userId,
    ]);
    return rows[0] ?? null;
  }

  async getUser(organizationId: string, userId: string) {
    const row = await this.loadUserRow(organizationId, userId);
    if (!row) throw new ScimError(404, "User not found");
    const groups = await this.groupsOf(organizationId, [row.id]);
    return this.userResource(row, groups.get(row.id));
  }

  async listUsers(organizationId: string, page: ScimPage) {
    const where = page.filter ? compileFilter(page.filter, USER_COLUMNS, 2) : null;
    const condition = where ? ` AND ${where.sql}` : "";
    const params: Array<string | boolean | number> = [organizationId, ...(where?.params ?? [])];
    const [{ count }]: Array<{ count: string }> = await AppDataSource.query(
      `SELECT count(*) AS count FROM (${USER_SELECT}${condition}) matched`,
      params,
    );
    const rows: UserRow[] =
      page.count === 0
        ? []
        : await AppDataSource.query(
            `${USER_SELECT}${condition} ORDER BY uo.created_at ASC, u.id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, page.count, page.startIndex - 1],
          );
    const groups = await this.groupsOf(
      organizationId,
      rows.map((row) => row.id),
    );
    return this.listResponse(
      rows.map((row) => this.userResource(row, groups.get(row.id))),
      Number(count),
      page,
    );
  }

  private listResponse(resources: unknown[], total: number, page: ScimPage) {
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex: page.startIndex,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  // ---- Users ----

  /** Only an address on a domain this organization proved with DNS can be provisioned. */
  private async assertProvisionableEmail(
    manager: EntityManager,
    organizationId: string,
    email: string,
  ): Promise<void> {
    if (email.length > 255 || !EMAIL_PATTERN.test(email)) {
      throw new ScimError(400, "userName must be the person's email address", "invalidValue");
    }
    const proven = await manager
      .getRepository(SsoDomain)
      .createQueryBuilder("domain")
      .where("domain.organization_id = :organizationId", { organizationId })
      .andWhere("domain.domain = :domain", { domain: emailDomainOf(email) })
      .andWhere("domain.verified_at IS NOT NULL")
      .getCount();
    if (proven === 0) {
      throw new ScimError(
        400,
        "The email domain is not verified for this organization",
        "invalidValue",
      );
    }
  }

  private async connectionOf(manager: EntityManager, organizationId: string) {
    return manager.getRepository(SsoConnection).findOne({ where: { organizationId } });
  }

  async createUser(actor: ScimActor, input: UserChanges & { userName: string }) {
    const organizationId = actor.organizationId;
    const email = input.userName.trim().toLowerCase();
    const active = input.active ?? true;
    try {
      const created = await AppDataSource.transaction(async (manager) => {
        await this.assertProvisionableEmail(manager, organizationId, email);
        const users = manager.getRepository(User);
        const memberships = manager.getRepository(UserOrganization);
        const existing = await users.findOne({ where: { email } });
        const connection = await this.connectionOf(manager, organizationId);
        const role = connection?.defaultRole ?? "member";
        if (existing) {
          // An account is never claimed. The one exception is a person this organization
          // provisioned before and later removed: they come back as they were.
          const link = await manager
            .getRepository(ScimUser)
            .findOne({ where: { organizationId, userId: existing.id } });
          const member = await memberships.findOne({
            where: { userId: existing.id, organizationId },
          });
          if (member || !link) {
            throw new ScimError(409, "A user with this userName already exists", "uniqueness");
          }
          await memberships.save(
            memberships.create({
              userId: existing.id,
              organizationId,
              role,
              isActive: active,
              joinedAt: new Date(),
            }),
          );
          if (
            active &&
            !existing.isActive &&
            (await this.activeOtherMemberships(organizationId, existing.id, manager)) === 0
          ) {
            await users.update({ id: existing.id }, { isActive: true });
          }
          if (input.externalId !== undefined) {
            await manager
              .getRepository(ScimUser)
              .update({ id: link.id }, { externalId: input.externalId });
          }
          return { id: existing.id, role };
        }
        const user = await users.save(
          users.create({
            email,
            // Nobody knows this password; the person signs in through the provider.
            password: await hashPassword(crypto.randomBytes(32).toString("base64url")),
            firstName: input.givenName?.slice(0, 255) || undefined,
            lastName: input.familyName?.slice(0, 255) || undefined,
            isActive: active,
            emailVerified: true,
            organizationId,
            role,
          }),
        );
        const userId = user.id;
        await memberships.save(
          memberships.create({
            userId,
            organizationId,
            role,
            isActive: active,
            joinedAt: new Date(),
          }),
        );
        await manager.getRepository(ScimUser).save(
          manager.getRepository(ScimUser).create({
            organizationId,
            userId,
            externalId: input.externalId ?? null,
          }),
        );
        return { id: userId, role };
      });
      await this.audit(actor, "scim.user.create", created.id, {
        email,
        role: created.role,
        active,
      });
      return this.getUser(organizationId, created.id);
    } catch (error) {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new ScimError(
          409,
          "A user with this userName or externalId already exists",
          "uniqueness",
        );
      }
      throw error;
    }
  }

  /** Applies a PUT or PATCH. Owners are never touched; an account used in other organizations only changes here. */
  async updateUser(actor: ScimActor, userId: string, changes: UserChanges) {
    const organizationId = actor.organizationId;
    const row = await this.loadUserRow(organizationId, userId);
    if (!row) throw new ScimError(404, "User not found");
    if (row.role === "owner") {
      throw new ScimError(403, "Owners are managed in Hay, not through SCIM");
    }

    const performed: string[] = [];

    try {
      await AppDataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const user = await users.findOneOrFail({ where: { id: userId } });
        // Any other membership, active or suspended, means the account is not this organization's alone.
        // Counted in the transaction that writes, so a membership added meanwhile is not missed.
        const otherOrganizations = await this.otherMembershipRows(organizationId, userId, manager);

        if (changes.userName !== undefined) {
          const email = changes.userName.trim().toLowerCase();
          if (email !== user.email) {
            if (otherOrganizations > 0) {
              throw new ScimError(
                400,
                "This address belongs to an account used in other organizations and cannot be changed here",
                "mutability",
              );
            }
            await this.assertProvisionableEmail(manager, organizationId, email);
            if (await users.findOne({ where: { email } })) {
              throw new ScimError(409, "A user with this userName already exists", "uniqueness");
            }
            user.email = email;
            user.tokenVersion = (user.tokenVersion ?? 0) + 1;
            // The provider's subject may follow the address; link again on the next sign-in.
            await manager.getRepository(SsoIdentity).delete({ organizationId, userId });
            performed.push("userName");
          }
        }

        // Names live on the account: only an account used in this organization alone is edited.
        if (otherOrganizations === 0) {
          if (
            changes.givenName !== undefined &&
            (changes.givenName ?? undefined) !== user.firstName
          ) {
            user.firstName = changes.givenName?.slice(0, 255) || undefined;
            performed.push("name.givenName");
          }
          if (
            changes.familyName !== undefined &&
            (changes.familyName ?? undefined) !== user.lastName
          ) {
            user.lastName = changes.familyName?.slice(0, 255) || undefined;
            performed.push("name.familyName");
          }
        }
        if (performed.length) await users.save(user);

        if (changes.externalId !== undefined) {
          const links = manager.getRepository(ScimUser);
          const link =
            (await links.findOne({ where: { organizationId, userId } })) ??
            links.create({ organizationId, userId });
          if ((link.externalId ?? null) !== changes.externalId) {
            link.externalId = changes.externalId;
            await links.save(link);
            performed.push("externalId");
          }
        }
      });
    } catch (error) {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new ScimError(
          409,
          "A user with this userName or externalId already exists",
          "uniqueness",
        );
      }
      throw error;
    }

    if (changes.active === false && (row.member_active || row.account_active)) {
      await this.deprovision(actor, userId, { remove: false });
      performed.push("active=false");
    } else if (changes.active === true && !(row.member_active && row.account_active)) {
      await this.reactivate(actor, userId);
      performed.push("active=true");
    } else if (performed.length) {
      await this.audit(actor, "scim.user.update", userId, { fields: performed });
    }
    return this.getUser(organizationId, userId);
  }

  private async otherMembershipRows(
    organizationId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<number> {
    const [{ count }]: Array<{ count: string }> = await manager.query(
      `SELECT count(*) AS count FROM user_organizations
        WHERE user_id = $1 AND organization_id <> $2`,
      [userId, organizationId],
    );
    return Number(count);
  }

  private async activeOtherMemberships(
    organizationId: string,
    userId: string,
    manager: EntityManager = AppDataSource.manager,
  ): Promise<number> {
    const [{ count }]: Array<{ count: string }> = await manager.query(
      `SELECT count(*) AS count FROM user_organizations
        WHERE user_id = $1 AND organization_id <> $2 AND is_active = true`,
      [userId, organizationId],
    );
    return Number(count);
  }

  /**
   * Removes a person from this organization and ends what let them in:
   * the membership, their single sign-on sessions for this organization, their
   * open dashboard sockets here and the API tokens they made here. When this was
   * their only organization the account is deactivated and every session ends.
   * Other organizations are never touched while the person still belongs to one.
   */
  async deprovision(actor: ScimActor, userId: string, options: { remove: boolean }) {
    const organizationId = actor.organizationId;
    const outcome = await AppDataSource.transaction(async (manager) => {
      const memberships = manager.getRepository(UserOrganization);
      const membership = await memberships.findOne({ where: { userId, organizationId } });
      if (!membership) throw new ScimError(404, "User not found");
      if (membership.role === "owner") {
        throw new ScimError(403, "Owners are managed in Hay, not through SCIM");
      }
      if (options.remove) {
        await manager.getRepository(ScimGroupMember).delete({ organizationId, userId });
        await memberships.remove(membership);
      } else {
        membership.isActive = false;
        await memberships.save(membership);
      }

      await manager.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'deprovisioned'
          WHERE user_id = $1 AND revoked_at IS NULL AND metadata->>'ssoOrganizationId' = $2`,
        [userId, organizationId],
      );
      const keys = await manager
        .getRepository(ApiKey)
        .update({ organizationId, createdByUserId: userId, isActive: true }, { isActive: false });

      const [{ count }]: Array<{ count: string }> = await manager.query(
        `SELECT count(*) AS count FROM user_organizations
          WHERE user_id = $1 AND organization_id <> $2 AND is_active = true`,
        [userId, organizationId],
      );
      const accountDeactivated = Number(count) === 0;
      if (accountDeactivated) {
        await manager.getRepository(User).update({ id: userId }, { isActive: false });
        await manager.query(
          `UPDATE sessions SET revoked_at = now(), revoked_reason = 'deprovisioned'
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
      }
      return { accountDeactivated, apiTokensRevoked: keys.affected ?? 0 };
    });

    const socketsClosed = websocketService.closeDashboardSockets(
      userId,
      outcome.accountDeactivated ? undefined : organizationId,
    );
    await this.audit(actor, options.remove ? "scim.user.delete" : "scim.user.deactivate", userId, {
      ...outcome,
      socketsClosed,
    });
  }

  /** Turns a deactivated person back on. The account is reactivated only if this organization was its only one. */
  private async reactivate(actor: ScimActor, userId: string): Promise<void> {
    const organizationId = actor.organizationId;
    await AppDataSource.transaction(async (manager) => {
      await manager
        .getRepository(UserOrganization)
        .update({ userId, organizationId }, { isActive: true });
      // The same rule as deprovision: only memberships elsewhere that are still active count.
      if ((await this.activeOtherMemberships(organizationId, userId, manager)) === 0) {
        await manager.getRepository(User).update({ id: userId }, { isActive: true });
      }
    });
    await this.audit(actor, "scim.user.reactivate", userId, {});
  }

  // ---- Groups ----

  private groupResource(group: ScimGroup, members: Array<{ id: string; email: string }>) {
    return {
      schemas: [SCIM_GROUP_SCHEMA],
      id: group.id,
      ...(group.externalId ? { externalId: group.externalId } : {}),
      displayName: group.displayName,
      members: members.map((member) => ({
        value: member.id,
        display: member.email,
        type: "User",
        $ref: `${scimBaseUrl()}/Users/${member.id}`,
      })),
      meta: {
        resourceType: "Group",
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
        location: `${scimBaseUrl()}/Groups/${group.id}`,
      },
    };
  }

  private async membersOf(organizationId: string, groupIds: string[]) {
    const byGroup = new Map<string, Array<{ id: string; email: string }>>();
    if (groupIds.length === 0) return byGroup;
    const rows: Array<{ group_id: string; id: string; email: string }> = await AppDataSource.query(
      `SELECT m.group_id, u.id, u.email
         FROM scim_group_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1 AND m.group_id = ANY($2::uuid[])
        ORDER BY u.email`,
      [organizationId, groupIds],
    );
    for (const row of rows) {
      const list = byGroup.get(row.group_id) ?? [];
      list.push({ id: row.id, email: row.email });
      byGroup.set(row.group_id, list);
    }
    return byGroup;
  }

  async getGroup(organizationId: string, groupId: string) {
    const group = await AppDataSource.getRepository(ScimGroup).findOne({
      where: { id: groupId, organizationId },
    });
    if (!group) throw new ScimError(404, "Group not found");
    const members = await this.membersOf(organizationId, [group.id]);
    return this.groupResource(group, members.get(group.id) ?? []);
  }

  async listGroups(organizationId: string, page: ScimPage) {
    const where = page.filter ? compileFilter(page.filter, GROUP_COLUMNS, 2) : null;
    const condition = where ? ` AND ${where.sql}` : "";
    const params: Array<string | boolean | number> = [organizationId, ...(where?.params ?? [])];
    const base = `SELECT g.id FROM scim_groups g WHERE g.organization_id = $1${condition}`;
    const [{ count }]: Array<{ count: string }> = await AppDataSource.query(
      `SELECT count(*) AS count FROM (${base}) matched`,
      params,
    );
    const ids: Array<{ id: string }> =
      page.count === 0
        ? []
        : await AppDataSource.query(
            `${base} ORDER BY g.display_name ASC, g.id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, page.count, page.startIndex - 1],
          );
    const groups = ids.length
      ? await AppDataSource.getRepository(ScimGroup)
          .createQueryBuilder("g")
          .where("g.id IN (:...ids)", { ids: ids.map((row) => row.id) })
          .getMany()
      : [];
    const order = new Map(ids.map((row, index) => [row.id, index]));
    groups.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const members = await this.membersOf(
      organizationId,
      groups.map((group) => group.id),
    );
    return this.listResponse(
      groups.map((group) => this.groupResource(group, members.get(group.id) ?? [])),
      Number(count),
      page,
    );
  }

  /** Member ids must name people of this organization. */
  private async assertMembers(
    manager: EntityManager,
    organizationId: string,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    const found: Array<{ user_id: string }> = await manager.query(
      `SELECT user_id FROM user_organizations WHERE organization_id = $1 AND user_id = ANY($2::uuid[])`,
      [organizationId, userIds],
    );
    if (new Set(found.map((row) => row.user_id)).size !== new Set(userIds).size) {
      throw new ScimError(400, "A member is not a user of this organization", "invalidValue");
    }
  }

  async createGroup(
    actor: ScimActor,
    input: { displayName: string; externalId?: string | null; members: string[] },
  ) {
    const organizationId = actor.organizationId;
    const before = await this.groupNamesOf(organizationId, input.members);
    try {
      const group = await AppDataSource.transaction(async (manager) => {
        await this.assertMembers(manager, organizationId, input.members);
        const groups = manager.getRepository(ScimGroup);
        const created = await groups.save(
          groups.create({
            organizationId,
            displayName: input.displayName,
            externalId: input.externalId ?? null,
          }),
        );
        await this.writeMembers(manager, organizationId, created.id, input.members);
        return created;
      });
      await this.applyGroupRoles(actor, before);
      await this.audit(actor, "scim.group.create", group.id, {
        displayName: input.displayName,
        members: input.members.length,
      });
      return this.getGroup(organizationId, group.id);
    } catch (error) {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new ScimError(
          409,
          "A group with this displayName or externalId already exists",
          "uniqueness",
        );
      }
      throw error;
    }
  }

  /** `members` replaces the member list when given; `add` and `remove` change it by name. */
  async updateGroup(
    actor: ScimActor,
    groupId: string,
    changes: {
      displayName?: string;
      externalId?: string | null;
      members?: string[];
      add?: string[];
      remove?: string[];
    },
  ) {
    const organizationId = actor.organizationId;
    const affected = new Set<string>();
    const existing = await AppDataSource.getRepository(ScimGroupMember).find({
      where: { groupId, organizationId },
    });
    const before = await this.groupNamesOf(organizationId, [
      ...existing.map((row) => row.userId),
      ...(changes.members ?? []),
      ...(changes.add ?? []),
      ...(changes.remove ?? []),
    ]);
    try {
      await AppDataSource.transaction(async (manager) => {
        const groups = manager.getRepository(ScimGroup);
        const group = await groups.findOne({ where: { id: groupId, organizationId } });
        if (!group) throw new ScimError(404, "Group not found");
        const members = manager.getRepository(ScimGroupMember);
        const current = new Set(
          (await members.find({ where: { groupId, organizationId } })).map((row) => row.userId),
        );

        const wanted = new Set(changes.members ?? current);
        for (const id of changes.add ?? []) wanted.add(id);
        for (const id of changes.remove ?? []) wanted.delete(id);
        await this.assertMembers(manager, organizationId, [...wanted]);

        const toAdd = [...wanted].filter((id) => !current.has(id));
        const toRemove = [...current].filter((id) => !wanted.has(id));
        await this.writeMembers(manager, organizationId, groupId, toAdd);
        if (toRemove.length) {
          await members
            .createQueryBuilder()
            .delete()
            .where("group_id = :groupId AND user_id IN (:...toRemove)", { groupId, toRemove })
            .execute();
        }
        const renamed =
          changes.displayName !== undefined && changes.displayName !== group.displayName;
        if (renamed) group.displayName = changes.displayName as string;
        if (changes.externalId !== undefined) group.externalId = changes.externalId;
        await groups.save(group);
        // A renamed group changes the role of everyone in it.
        for (const id of renamed ? wanted : [...toAdd, ...toRemove]) affected.add(id);
        for (const id of toRemove) affected.add(id);
      });
    } catch (error) {
      if (isPgError(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new ScimError(
          409,
          "A group with this displayName or externalId already exists",
          "uniqueness",
        );
      }
      throw error;
    }
    await this.applyGroupRoles(actor, before);
    await this.audit(actor, "scim.group.update", groupId, { affected: affected.size });
    return this.getGroup(organizationId, groupId);
  }

  async deleteGroup(actor: ScimActor, groupId: string): Promise<void> {
    const organizationId = actor.organizationId;
    const members = await AppDataSource.getRepository(ScimGroupMember).find({
      where: { groupId, organizationId },
    });
    const before = await this.groupNamesOf(
      organizationId,
      members.map((member) => member.userId),
    );
    const result = await AppDataSource.getRepository(ScimGroup).delete({
      id: groupId,
      organizationId,
    });
    if (!result.affected) throw new ScimError(404, "Group not found");
    await this.applyGroupRoles(actor, before);
    await this.audit(actor, "scim.group.delete", groupId, { members: members.length });
  }

  private async writeMembers(
    manager: EntityManager,
    organizationId: string,
    groupId: string,
    userIds: string[],
  ): Promise<void> {
    const repository = manager.getRepository(ScimGroupMember);
    for (const userId of new Set(userIds)) {
      await repository.save(repository.create({ organizationId, groupId, userId }));
    }
  }

  /** The names of the groups each person is in now, for comparing with what they are in after a change. */
  private async groupNamesOf(organizationId: string, userIds: string[]) {
    const unique = [...new Set(userIds)];
    const groups = await this.groupsOf(organizationId, unique);
    return new Map(
      unique.map((id) => [id, (groups.get(id) ?? []).map((group) => group.displayName)]),
    );
  }

  /**
   * Gives a person the role their groups map to, through the same mapping sign-in
   * uses, but only when the role their mapped groups give has changed. Someone
   * promoted by hand who is pushed into an unrelated group keeps the role they
   * have. Without a mapping groups never change a role. Someone who is no longer
   * in any mapped group gets the default role. An owner is never changed.
   * `before` is each person's group names from before the change.
   */
  private async applyGroupRoles(actor: ScimActor, before: Map<string, string[]>): Promise<void> {
    if (before.size === 0) return;
    const organizationId = actor.organizationId;
    const connection = await this.connectionOf(AppDataSource.manager, organizationId);
    if (!connection || Object.keys(connection.roleMapping).length === 0) return;
    const after = await this.groupNamesOf(organizationId, [...before.keys()]);
    for (const [userId, namesBefore] of before) {
      const roleBefore = roleForGroups(connection.roleMapping, namesBefore);
      const roleAfter = roleForGroups(connection.roleMapping, after.get(userId) ?? []);
      if (roleBefore === roleAfter) continue;
      const membership = await AppDataSource.getRepository(UserOrganization).findOne({
        where: { userId, organizationId },
      });
      if (!membership || membership.role === "owner") continue;
      const role = roleAfter ?? connection.defaultRole;
      if (membership.role === role) continue;
      const previous = membership.role;
      membership.role = role;
      await AppDataSource.getRepository(UserOrganization).save(membership);
      logger.info(
        { organizationId, userId, from: previous, to: role },
        "SCIM group changed a role",
      );
      await this.audit(actor, "scim.role.change", userId, { from: previous, to: role });
    }
  }

  // ---- Audit ----

  async audit(
    actor: ScimActor,
    action: Parameters<typeof auditLogService.record>[0]["action"],
    resourceId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await auditLogService.record({
      organizationId: actor.organizationId,
      action,
      resource: "scim",
      changes: { ...changes, resourceId },
      metadata: { tokenId: actor.tokenId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}

export const scimService = new ScimService();
