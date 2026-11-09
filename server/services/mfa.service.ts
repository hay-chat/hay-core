import * as crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { QueryFailedError } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { UserMfa } from "@server/database/entities/user-mfa.entity";
import type { Organization } from "@server/entities/organization.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { decryptValue, encryptValue } from "@server/lib/auth/utils/encryption";
import {
  base32Encode,
  findTotpStep,
  generateTotpSecret,
  totpProvisioningUri,
} from "@server/lib/auth/totp";
import { auditLogService } from "@server/services/audit-log.service";
import { rateLimitService } from "@server/services/rate-limit.service";

export const MFA_STEP_UP_REQUIRED_ERROR_TYPE = "MFA_STEP_UP_REQUIRED";
export const MFA_ENROLMENT_REQUIRED_ERROR_TYPE = "MFA_ENROLMENT_REQUIRED";
export const MFA_INVALID_CODE_ERROR_TYPE = "MFA_INVALID_CODE";

const MFA_ISSUER = "Hay";
const STEP_UP_TTL_MS = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
/** 80 bits per code, which is why a plain digest is enough to store them. */
const RECOVERY_CODE_BYTES = 10;

const VERIFY_WINDOW_SECONDS = 15 * 60;
const VERIFY_MAX_PER_USER = 5;
const VERIFY_MAX_PER_IP = 30;

const POSTGRES_UNDEFINED_TABLE = "42P01";

export type MfaMethod = "totp" | "recovery";

export interface MfaRequestInfo {
  ipAddress?: string;
  userAgent?: string;
}

export function organizationRequiresMfa(
  organization: Pick<Organization, "settings"> | undefined | null,
): boolean {
  return organization?.settings?.mfaRequired === true;
}

function mfaError(code: "FORBIDDEN" | "BAD_REQUEST", message: string, type: string): TRPCError {
  return new TRPCError({ code, message, cause: { type } });
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** XXXX-XXXX-XXXX-XXXX */
function generateRecoveryCode(): string {
  const raw = base32Encode(crypto.randomBytes(RECOVERY_CODE_BYTES));
  return raw.match(/.{1,4}/g)!.join("-");
}

function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

export class MfaService {
  private get repository() {
    return AppDataSource.getRepository(UserMfa);
  }

  /**
   * The active enrolment, or null. Migrations run after deploy: until the
   * table exists nobody can have enrolled, and login has to keep working.
   */
  async findConfirmed(userId: string): Promise<UserMfa | null> {
    try {
      const enrolment = await this.repository.findOne({ where: { userId } });
      return enrolment?.confirmedAt ? enrolment : null;
    } catch (error) {
      const driverCode =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string } | undefined)?.code
          : undefined;
      if (driverCode === POSTGRES_UNDEFINED_TABLE) return null;
      throw error;
    }
  }

  async status(userId: string): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
    const enrolment = await this.findConfirmed(userId);
    return {
      enabled: !!enrolment,
      recoveryCodesRemaining: enrolment?.recoveryCodes.length ?? 0,
    };
  }

  /** Whether one of the user's organizations requires MFA and the user has not enrolled. */
  async enrolmentRequired(userId: string): Promise<boolean> {
    const memberships = await AppDataSource.getRepository(UserOrganization).find({
      where: { userId, isActive: true },
      relations: ["organization"],
    });
    if (!memberships.some((membership) => organizationRequiresMfa(membership.organization))) {
      return false;
    }
    return !(await this.findConfirmed(userId));
  }

  /** Start (or restart) enrolment. A confirmed enrolment is never overwritten. */
  async beginEnrolment(user: {
    id: string;
    email: string;
  }): Promise<{ secret: string; otpauthUri: string }> {
    const secret = generateTotpSecret();
    const rows: unknown[] = await AppDataSource.query(
      `INSERT INTO "user_mfa" ("user_id", "secret")
       VALUES ($1, $2)
       ON CONFLICT ("user_id") DO UPDATE SET "secret" = EXCLUDED."secret", "updated_at" = now()
       WHERE "user_mfa"."confirmed_at" IS NULL
       RETURNING "id"`,
      [user.id, encryptValue(secret)],
    );
    if (rows.length === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Two-factor authentication is already enabled",
      });
    }
    return { secret, otpauthUri: totpProvisioningUri(secret, user.email, MFA_ISSUER) };
  }

  /** Activate a pending enrolment. Returns the recovery codes, shown only this once. */
  async confirmEnrolment(
    user: { id: string; email: string },
    code: string,
    request: MfaRequestInfo,
  ): Promise<string[]> {
    await this.consumeAttempt(user.email, request.ipAddress);

    const recovery = await AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserMfa);
      const enrolment = await repository.findOne({
        where: { userId: user.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!enrolment || enrolment.confirmedAt) return null;

      const step = findTotpStep(decryptValue(enrolment.secret), code, Date.now());
      if (step === null) return null;

      const codes = generateRecoveryCodes();
      enrolment.confirmedAt = new Date();
      enrolment.lastUsedStep = step;
      enrolment.recoveryCodes = codes.hashes;
      await repository.save(enrolment);
      return codes.plain;
    });

    if (!recovery) {
      throw mfaError("BAD_REQUEST", "Invalid verification code", MFA_INVALID_CODE_ERROR_TYPE);
    }
    await rateLimitService.resetRateLimit(user.email, "email", "mfa-verify");
    await auditLogService.record({
      userId: user.id,
      action: "mfa.enable",
      resource: "auth",
      ...request,
    });
    return recovery;
  }

  /**
   * Check a TOTP or recovery code. Attempts are limited per user and per IP,
   * and refused outright while the limiter is unavailable.
   */
  async verify(
    user: { id: string; email: string },
    code: string,
    request: MfaRequestInfo,
  ): Promise<MfaMethod> {
    await this.consumeAttempt(user.email, request.ipAddress);

    const method = await this.checkCode(user.id, code);
    if (!method) {
      await auditLogService.record({
        userId: user.id,
        action: "mfa.verify",
        resource: "auth",
        status: "failure",
        ...request,
      });
      throw mfaError("BAD_REQUEST", "Invalid verification code", MFA_INVALID_CODE_ERROR_TYPE);
    }

    await rateLimitService.resetRateLimit(user.email, "email", "mfa-verify");
    if (method === "recovery") {
      await auditLogService.record({
        userId: user.id,
        action: "mfa.recovery_code_used",
        resource: "auth",
        ...request,
      });
    }
    return method;
  }

  /** Locks the row, so a code cannot be spent twice by concurrent requests. */
  private async checkCode(userId: string, code: string): Promise<MfaMethod | null> {
    return AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserMfa);
      const enrolment = await repository.findOne({
        where: { userId },
        lock: { mode: "pessimistic_write" },
      });
      if (!enrolment?.confirmedAt) return null;

      if (/^\d{6}$/.test(code)) {
        const step = findTotpStep(
          decryptValue(enrolment.secret),
          code,
          Date.now(),
          enrolment.lastUsedStep ?? null,
        );
        if (step === null) return null;
        enrolment.lastUsedStep = step;
        await repository.save(enrolment);
        return "totp";
      }

      const hash = hashRecoveryCode(code);
      if (!enrolment.recoveryCodes.includes(hash)) return null;
      enrolment.recoveryCodes = enrolment.recoveryCodes.filter((stored) => stored !== hash);
      await repository.save(enrolment);
      return "recovery";
    });
  }

  private async consumeAttempt(email: string, ipAddress: string | undefined): Promise<void> {
    const options = { scope: "mfa-verify", failClosed: true } as const;
    const [byIp, byUser] = [
      await rateLimitService.checkIpRateLimit(
        ipAddress || "unknown",
        VERIFY_MAX_PER_IP,
        VERIFY_WINDOW_SECONDS,
        options,
      ),
      await rateLimitService.checkEmailRateLimit(
        email,
        VERIFY_MAX_PER_USER,
        VERIFY_WINDOW_SECONDS,
        options,
      ),
    ];
    if (byIp.limited || byUser.limited) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many verification attempts. Please try again later.",
      });
    }
  }

  async disable(
    user: { id: string; email: string },
    code: string,
    request: MfaRequestInfo,
  ): Promise<void> {
    await this.verify(user, code, request);
    await this.repository.delete({ userId: user.id });
    await auditLogService.record({
      userId: user.id,
      action: "mfa.disable",
      resource: "auth",
      ...request,
    });
  }

  async regenerateRecoveryCodes(
    user: { id: string; email: string },
    code: string,
    request: MfaRequestInfo,
  ): Promise<string[]> {
    await this.verify(user, code, request);
    const codes = generateRecoveryCodes();
    await this.repository.update({ userId: user.id }, { recoveryCodes: codes.hashes });
    await auditLogService.record({
      userId: user.id,
      action: "mfa.recovery_codes_regenerate",
      resource: "auth",
      ...request,
    });
    return codes.plain;
  }

  /** Let this session perform sensitive actions for the next few minutes. */
  async grantStepUp(userId: string, sessionId: string): Promise<void> {
    await this.repository.update(
      { userId },
      { stepUpSessionId: sessionId, stepUpExpiresAt: new Date(Date.now() + STEP_UP_TTL_MS) },
    );
  }

  /**
   * Guards sensitive actions. API tokens have no second factor to present, and
   * what they may do is limited by their scopes. People without MFA pass,
   * unless their organization requires it.
   */
  async assertStepUp(user: AuthUser): Promise<void> {
    if (user.authMethod !== "jwt") return;

    const enrolment = await this.findConfirmed(user.id);
    if (!enrolment) {
      if (organizationRequiresMfa(user.userOrganization?.organization)) {
        throw mfaError(
          "FORBIDDEN",
          "This organization requires two-factor authentication",
          MFA_ENROLMENT_REQUIRED_ERROR_TYPE,
        );
      }
      return;
    }

    const stillValid =
      !!user.sessionId &&
      enrolment.stepUpSessionId === user.sessionId &&
      !!enrolment.stepUpExpiresAt &&
      enrolment.stepUpExpiresAt > new Date();
    if (!stillValid) {
      throw mfaError(
        "FORBIDDEN",
        "Confirm your two-factor code to continue",
        MFA_STEP_UP_REQUIRED_ERROR_TYPE,
      );
    }
  }

  /** Org-bound requests from people who have not enrolled yet, in an organization requiring MFA. */
  async assertEnrolledIfRequired(user: AuthUser): Promise<void> {
    if (user.authMethod !== "jwt") return;
    if (!organizationRequiresMfa(user.userOrganization?.organization)) return;
    if (await this.findConfirmed(user.id)) return;
    throw mfaError(
      "FORBIDDEN",
      "This organization requires two-factor authentication",
      MFA_ENROLMENT_REQUIRED_ERROR_TYPE,
    );
  }
}

export const mfaService = new MfaService();
