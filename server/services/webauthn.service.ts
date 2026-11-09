import { TRPCError } from "@trpc/server";
import { QueryFailedError } from "typeorm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AppDataSource } from "@server/database/data-source";
import { UserMfa } from "@server/database/entities/user-mfa.entity";
import { UserWebauthnCredential } from "@server/database/entities/user-webauthn-credential.entity";
import { User } from "@server/entities/user.entity";
import type { AuthUser } from "@server/lib/auth/AuthUser";
import { verifyPassword } from "@server/lib/auth/utils/hashing";
import { getWebauthnConfig, type WebauthnConfig } from "@server/lib/auth/webauthn-config";
import { auditLogService } from "@server/services/audit-log.service";
import {
  MFA_INVALID_CODE_ERROR_TYPE,
  generateRecoveryCodes,
  mfaService,
  type MfaRequestInfo,
} from "@server/services/mfa.service";
import { rateLimitService } from "@server/services/rate-limit.service";
import { redisService } from "@server/services/redis.service";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const POSTGRES_UNIQUE_VIOLATION = "23505";
const DEFAULT_NAME = "Security key";

/** Where a sign-in challenge is kept: the login step, or a step-up for one session. */
export type AssertionScope = { purpose: "login" } | { purpose: "stepup"; sessionId: string };

export interface WebauthnCredentialSummary {
  id: string;
  name: string;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

function toSummary(credential: UserWebauthnCredential): WebauthnCredentialSummary {
  return {
    id: credential.id,
    name: credential.name,
    transports: credential.transports,
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt ?? null,
  };
}

function invalid(message: string): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message,
    cause: { type: MFA_INVALID_CODE_ERROR_TYPE },
  });
}

function requireConfig(): WebauthnConfig {
  const webauthnConfig = getWebauthnConfig();
  if (!webauthnConfig) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Security keys are not configured on this server",
    });
  }
  return webauthnConfig;
}

/** Challenges live in Redis only: without it nothing is issued and nothing is accepted. */
function requireRedis() {
  const client = redisService.isConnected() ? redisService.getClient() : null;
  if (!client) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Security keys are temporarily unavailable",
    });
  }
  return client;
}

function challengeKey(userId: string, scope: AssertionScope | { purpose: "register" }): string {
  const session = "sessionId" in scope ? `:${scope.sessionId}` : "";
  return `webauthn:challenge:${scope.purpose}:${userId}${session}`;
}

async function saveChallenge(key: string, challenge: string): Promise<void> {
  await requireRedis().set(key, challenge, "EX", CHALLENGE_TTL_SECONDS);
}

/** Reads and deletes in one step, so a challenge can be answered once. */
async function takeChallenge(key: string): Promise<string | null> {
  return requireRedis().getdel(key);
}

export class WebauthnService {
  private get repository() {
    return AppDataSource.getRepository(UserWebauthnCredential);
  }

  async list(userId: string): Promise<WebauthnCredentialSummary[]> {
    const credentials = await this.repository.find({
      where: { userId },
      order: { createdAt: "ASC" },
    });
    return credentials.map(toSummary);
  }

  async rename(userId: string, id: string, name: string): Promise<void> {
    const result = await this.repository.update({ id, userId }, { name: name.trim() });
    if (!result.affected) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });
  }

  /**
   * Adding the first factor needs the password, as for an authenticator app.
   * Adding another needs a recent second-factor check from this session.
   */
  private async authoriseEnrolment(user: AuthUser, password: string | undefined): Promise<void> {
    if (await mfaService.hasSecondFactor(user.id)) {
      await mfaService.assertStepUp(user);
      return;
    }
    const account = await AppDataSource.getRepository(User).findOne({ where: { id: user.id } });
    if (!password || !account || !(await verifyPassword(password, account.password))) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Password is incorrect" });
    }
  }

  async registrationOptions(
    user: AuthUser,
    password: string | undefined,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const webauthnConfig = requireConfig();
    requireRedis();
    await this.authoriseEnrolment(user, password);

    const existing = await this.repository.find({ where: { userId: user.id } });
    const options = await generateRegistrationOptions({
      rpName: webauthnConfig.rpName,
      rpID: webauthnConfig.rpId,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    await saveChallenge(challengeKey(user.id, { purpose: "register" }), options.challenge);
    return options;
  }

  /**
   * Stores the new key. When it is the person's first factor, recovery codes are
   * issued (shown once) and returned, which tells the caller to end other sessions.
   */
  async verifyRegistration(
    user: AuthUser,
    response: RegistrationResponseJSON,
    name: string | undefined,
    request: MfaRequestInfo,
  ): Promise<{
    credential: WebauthnCredentialSummary;
    recoveryCodes: string[] | null;
  }> {
    const webauthnConfig = requireConfig();
    const hadFactor = await mfaService.hasSecondFactor(user.id);
    if (hadFactor) await mfaService.assertStepUp(user);

    const expectedChallenge = await takeChallenge(challengeKey(user.id, { purpose: "register" }));
    if (!expectedChallenge) throw invalid("Registration timed out. Please try again.");

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: webauthnConfig.origins,
        expectedRPID: webauthnConfig.rpId,
        requireUserVerification: false,
      });
    } catch {
      throw invalid("The security key could not be verified");
    }
    if (!verification.verified) throw invalid("The security key could not be verified");
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const recovery = hadFactor ? null : generateRecoveryCodes();
    let saved: UserWebauthnCredential;
    try {
      saved = await AppDataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO "user_mfa" ("user_id") VALUES ($1) ON CONFLICT ("user_id") DO NOTHING`,
          [user.id],
        );
        if (recovery) {
          await manager
            .getRepository(UserMfa)
            .update({ userId: user.id }, { recoveryCodes: recovery.hashes });
        }
        const repository = manager.getRepository(UserWebauthnCredential);
        return repository.save(
          repository.create({
            userId: user.id,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            signCount: credential.counter,
            transports: credential.transports ?? [],
            name: name?.trim() || DEFAULT_NAME,
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
          }),
        );
      });
    } catch (error) {
      const driverCode =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string } | undefined)?.code
          : undefined;
      if (driverCode === POSTGRES_UNIQUE_VIOLATION) {
        throw new TRPCError({ code: "CONFLICT", message: "This key is already registered" });
      }
      throw error;
    }

    await auditLogService.record({
      userId: user.id,
      action: "webauthn.add",
      resource: "auth",
      metadata: { credentialRecordId: saved.id, name: saved.name },
      ...request,
    });
    return { credential: toSummary(saved), recoveryCodes: recovery?.plain ?? null };
  }

  async authenticationOptions(
    userId: string,
    scope: AssertionScope,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const webauthnConfig = requireConfig();
    requireRedis();
    const credentials = await this.repository.find({ where: { userId } });
    if (credentials.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No security keys are registered" });
    }
    const options = await generateAuthenticationOptions({
      rpID: webauthnConfig.rpId,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as never,
      })),
      userVerification: "preferred",
    });
    await saveChallenge(challengeKey(userId, scope), options.challenge);
    return options;
  }

  /**
   * Checks a sign-in with a registered key. Attempts are limited like codes are,
   * and a signature counter that went backwards is refused and audited.
   */
  async verifyAuthentication(
    user: { id: string; email: string },
    scope: AssertionScope,
    response: AuthenticationResponseJSON,
    request: MfaRequestInfo,
  ): Promise<void> {
    const webauthnConfig = requireConfig();
    await mfaService.consumeAttempt(user.email, request.ipAddress);

    const fail = async (message: string): Promise<never> => {
      await auditLogService.record({
        userId: user.id,
        action: "webauthn.verify",
        resource: "auth",
        status: "failure",
        ...request,
      });
      throw invalid(message);
    };

    const expectedChallenge = await takeChallenge(challengeKey(user.id, scope));
    if (!expectedChallenge) return fail("Verification timed out. Please try again.");

    const stored = await this.repository.findOne({
      where: { userId: user.id, credentialId: response.id },
    });
    if (!stored) return fail("Security key verification failed");

    let newCounter: number;
    let backedUp: boolean;
    try {
      // The counter is compared below, under a row lock, so a regression can be audited.
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: webauthnConfig.origins,
        expectedRPID: webauthnConfig.rpId,
        requireUserVerification: false,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(stored.publicKey),
          counter: 0,
          transports: stored.transports as never,
        },
      });
      if (!verification.verified) return fail("Security key verification failed");
      newCounter = verification.authenticationInfo.newCounter;
      backedUp = verification.authenticationInfo.credentialBackedUp;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      return fail("Security key verification failed");
    }

    const accepted = await AppDataSource.transaction(async (manager) => {
      const repository = manager.getRepository(UserWebauthnCredential);
      const current = await repository.findOne({
        where: { id: stored.id },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) return false;
      // Authenticators that do not count report 0 every time.
      if ((newCounter > 0 || current.signCount > 0) && newCounter <= current.signCount) {
        return false;
      }
      current.signCount = newCounter;
      current.backedUp = backedUp;
      current.lastUsedAt = new Date();
      await repository.save(current);
      return true;
    });
    if (!accepted) {
      await auditLogService.record({
        userId: user.id,
        action: "webauthn.counter_regression",
        resource: "auth",
        status: "failure",
        metadata: { credentialRecordId: stored.id },
        ...request,
      });
      throw invalid("Security key verification failed");
    }

    await rateLimitService.resetRateLimit(user.email, "email", "mfa-verify");
  }

  /** Removes a key. Refused when it is the last factor of someone whose organization requires one. */
  async remove(user: AuthUser, id: string, request: MfaRequestInfo): Promise<void> {
    await mfaService.assertStepUp(user);

    await AppDataSource.transaction(async (manager) => {
      // Lock the person's MFA row so concurrent removals cannot each see another key remaining.
      const mfa = await manager.getRepository(UserMfa).findOne({
        where: { userId: user.id },
        lock: { mode: "pessimistic_write" },
      });
      const repository = manager.getRepository(UserWebauthnCredential);
      const credential = await repository.findOne({ where: { id, userId: user.id } });
      if (!credential) throw new TRPCError({ code: "NOT_FOUND", message: "Key not found" });

      const others = (await repository.count({ where: { userId: user.id } })) - 1;
      const totp = !!mfa?.confirmedAt && !!mfa.secret;
      await mfaService.assertFactorMayBeRemoved(user.id, totp || others > 0);

      await repository.delete({ id });
      // With no factor left, the recovery codes have nothing to recover.
      if (!totp && others === 0) await manager.getRepository(UserMfa).delete({ userId: user.id });
    });

    await auditLogService.record({
      userId: user.id,
      action: "webauthn.remove",
      resource: "auth",
      metadata: { credentialRecordId: id },
      ...request,
    });
  }
}

export const webauthnService = new WebauthnService();
