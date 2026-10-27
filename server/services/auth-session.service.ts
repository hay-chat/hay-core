import * as crypto from "crypto";
import { AppDataSource } from "@server/database/data-source";
import { Session, type SessionRevokedReason } from "@server/entities/session.entity";
import { User } from "@server/entities/user.entity";
import { authConfig } from "@server/config/auth.config";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateAccessToken,
  verifyRefreshToken,
} from "@server/lib/auth/utils/jwt";
import type { AuthTokens } from "@server/types/auth.types";
import { createLogger } from "@server/lib/logger";
import { LessThan, QueryFailedError, type EntityManager, type Repository } from "typeorm";

const logger = createLogger("auth-session");

/** A session that sees no refresh for this long ends. Every refresh slides it. */
export const SESSION_IDLE_TIMEOUT_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * After a rotation the previous refresh token keeps working for this long and
 * returns the current one. Covers a refresh whose response was lost on a weak
 * mobile connection (the client retries with the token it still holds) and two
 * tabs refreshing at once. Past this window a reused token revokes the family.
 */
export const REFRESH_REUSE_GRACE_MS = 2 * 60 * 1000;

/** Revoked/expired rows are kept this long (audit trail), then deleted. */
const SESSION_RETENTION_AFTER_END_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_PREFIX = "hrt1";

export type RefreshRejectionReason = "invalid" | "expired" | "revoked" | "reused";

/**
 * The refresh token was definitively rejected: the client must log out.
 * Anything else thrown by this service (database down, ...) is transient.
 */
export class RefreshRejectedError extends Error {
  constructor(public readonly reason: RefreshRejectionReason) {
    super(`Refresh token rejected: ${reason}`);
    this.name = "RefreshRejectedError";
  }
}

type RefreshOutcome = { tokens: AuthTokens } | { rejected: RefreshRejectionReason };

export interface SessionClientInfo {
  ipAddress?: string;
  userAgent?: string;
}

function mac(sessionId: string, generation: number): string {
  return crypto
    .createHmac("sha256", authConfig.jwt.refreshSecret)
    .update(`${TOKEN_PREFIX}:${sessionId}:${generation}`)
    .digest("base64url");
}

/** `hrt1.<sessionId>.<generation>.<hmac>`; derived, never stored. */
function encodeRefreshToken(sessionId: string, generation: number): string {
  return `${TOKEN_PREFIX}.${sessionId}.${generation}.${mac(sessionId, generation)}`;
}

function decodeRefreshToken(token: string): { sessionId: string; generation: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const [, sessionId, generationRaw, signature] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !/^\d{1,9}$/.test(generationRaw)) return null;
  const generation = Number(generationRaw);

  const expected = Buffer.from(mac(sessionId, generation));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { sessionId, generation };
}

function tokensFor(user: User, session: Session): AuthTokens {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: encodeRefreshToken(session.id, session.generation),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "23505"
  );
}

function truncate(value: string | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null;
}

export class AuthSessionService {
  /**
   * Start a new session (one login on one device) and issue its first tokens.
   * Pass `manager` when the user row is written in the same transaction.
   */
  async createSession(
    user: User,
    client: SessionClientInfo = {},
    manager: EntityManager = AppDataSource.manager,
    legacyTokenHash: string | null = null,
  ): Promise<AuthTokens> {
    const now = new Date();
    const repo = manager.getRepository(Session);
    const session = await repo.save(
      repo.create({
        userId: user.id,
        generation: 0,
        tokenVersion: user.tokenVersion ?? 0,
        lastActivity: now,
        expiresAt: new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS),
        ipAddress: truncate(client.ipAddress, 255),
        userAgent: truncate(client.userAgent, 1000),
        legacyTokenHash,
      }),
    );
    return tokensFor(user, session);
  }

  /**
   * Exchange a refresh token for a new access token and a new refresh token,
   * sliding the session by the idle timeout.
   *
   * Throws RefreshRejectedError for a definitive rejection; any other error
   * (e.g. the database is unreachable) must not log the user out.
   */
  async refresh(refreshToken: string, client: SessionClientInfo = {}): Promise<AuthTokens> {
    const decoded = decodeRefreshToken(refreshToken);
    if (!decoded) {
      return this.refreshLegacy(refreshToken, client);
    }

    const result = await AppDataSource.transaction(async (manager): Promise<RefreshOutcome> => {
      const repo = manager.getRepository(Session);
      // Row lock: two concurrent refreshes with the same token are serialized,
      // so the second one sees the rotation and takes the grace branch.
      const session = await repo.findOne({
        where: { id: decoded.sessionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!session) return { rejected: "invalid" };
      if (session.revokedAt) return { rejected: "revoked" };

      const now = new Date();
      if (session.expiresAt.getTime() <= now.getTime()) return { rejected: "expired" };

      const user = await manager.getRepository(User).findOne({ where: { id: session.userId } });
      if (!user || !user.isActive) {
        return { rejected: "revoked" };
      }
      if ((user.tokenVersion ?? 0) !== session.tokenVersion) {
        await this.markRevoked(repo, session, "password_changed", now);
        return { rejected: "revoked" };
      }

      if (decoded.generation === session.generation) {
        session.generation += 1;
        session.rotatedAt = now;
        session.lastActivity = now;
        session.expiresAt = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
        session.ipAddress = truncate(client.ipAddress, 255) ?? session.ipAddress;
        session.userAgent = truncate(client.userAgent, 1000) ?? session.userAgent;
        await repo.save(session);
        return { tokens: tokensFor(user, session) };
      }

      const withinGrace =
        decoded.generation === session.generation - 1 &&
        session.rotatedAt != null &&
        now.getTime() - session.rotatedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
      if (withinGrace) {
        // Same answer as the rotation that just happened: no new generation.
        return { tokens: tokensFor(user, session) };
      }

      if (decoded.generation < session.generation) {
        // An old token came back: someone else holds a copy. End the family.
        await this.markRevoked(repo, session, "reuse_detected", now);
        logger.warn(
          { sessionId: session.id, userId: session.userId },
          "Refresh token reuse detected; session revoked",
        );
        return { rejected: "reused" };
      }

      return { rejected: "invalid" };
    });

    if ("rejected" in result) throw new RefreshRejectedError(result.rejected);
    return result.tokens;
  }

  /**
   * Pre-rotation JWT refresh tokens: accept once and move the device onto a
   * rotating session, so the D11-3 deploy logs nobody out.
   * TODO: remove (with verifyRefreshToken and JWTs' RefreshTokenPayload) once
   * every legacy token has expired: 30 days after the D11-3 deploy.
   */
  private async refreshLegacy(
    refreshToken: string,
    client: SessionClientInfo,
  ): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (error) {
      const expired = error instanceof Error && error.message === "Token has expired";
      throw new RefreshRejectedError(expired ? "expired" : "invalid");
    }

    const user = await AppDataSource.getRepository(User).findOne({
      where: { id: payload.userId },
    });
    if (!user || !user.isActive) throw new RefreshRejectedError("revoked");
    if (payload.tokenVersion !== undefined && payload.tokenVersion !== (user.tokenVersion ?? 0)) {
      throw new RefreshRejectedError("revoked");
    }

    // Accept once: the new session records the token's hash under a unique
    // index, so a replay (or a concurrent second use) cannot mint another.
    const legacyTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const sessions = AppDataSource.getRepository(Session);
    if (await sessions.exists({ where: { legacyTokenHash } })) {
      throw new RefreshRejectedError("reused");
    }
    try {
      return await this.createSession(user, client, AppDataSource.manager, legacyTokenHash);
    } catch (error) {
      if (isUniqueViolation(error)) throw new RefreshRejectedError("reused");
      throw error;
    }
  }

  /**
   * End the session a refresh token belongs to (explicit logout). Idempotent.
   * Returns the session's user (also for an already-ended session), or null
   * when the token names no session.
   */
  async revoke(refreshToken: string): Promise<string | null> {
    const decoded = decodeRefreshToken(refreshToken);
    if (!decoded) return null;
    const repo = AppDataSource.getRepository(Session);
    const session = await repo.findOne({ where: { id: decoded.sessionId } });
    if (!session) return null;
    if (!session.revokedAt) await this.markRevoked(repo, session, "logout", new Date());
    return session.userId;
  }

  /** Delete sessions that ended (expired or revoked) more than 30 days ago. */
  async cleanupEndedSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - SESSION_RETENTION_AFTER_END_MS);
    const repo = AppDataSource.getRepository(Session);
    const expired = await repo.delete({ expiresAt: LessThan(cutoff) });
    const revoked = await repo.delete({ revokedAt: LessThan(cutoff) });
    return (expired.affected ?? 0) + (revoked.affected ?? 0);
  }

  private async markRevoked(
    repo: Repository<Session>,
    session: Session,
    reason: SessionRevokedReason,
    at: Date,
  ): Promise<void> {
    session.revokedAt = at;
    session.revokedReason = reason;
    await repo.save(session);
  }
}

export const authSessionService = new AuthSessionService();
