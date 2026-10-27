import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from "@jest/globals";
import * as jwt from "jsonwebtoken";
import { AppDataSource } from "@server/database/data-source";
import { User } from "@server/entities/user.entity";
import { Session } from "@server/entities/session.entity";
import { authConfig } from "@server/config/auth.config";
import {
  authSessionService,
  RefreshRejectedError,
  REFRESH_REUSE_GRACE_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "@server/services/auth-session.service";
import { verifyToken } from "@server/lib/auth/utils/jwt";
import { authRouter } from "@server/routes/v1/auth";
import type { Context } from "@server/trpc/context";

/**
 * DB-backed: rotation correctness lives in row locking and the
 * generation/rotated_at state, which a mock would only restate.
 */
describe("auth sessions: rotating, sliding refresh tokens (D11-3)", () => {
  const userId = "d1130000-0000-4000-8000-0000000000aa";
  let user: User;

  const sessions = () => AppDataSource.getRepository(Session);
  const sessionIdOf = (token: string) => token.split(".")[1];
  const load = async (token: string) =>
    sessions().findOneOrFail({ where: { id: sessionIdOf(token) } });

  async function expectRejected(token: string, reason: RefreshRejectedError["reason"]) {
    await expect(authSessionService.refresh(token)).rejects.toMatchObject({
      name: "RefreshRejectedError",
      reason,
    });
  }

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    await AppDataSource.runMigrations();

    const userRepo = AppDataSource.getRepository(User);
    await userRepo.delete({ id: userId });
    user = await userRepo.save(
      userRepo.create({
        id: userId,
        email: "d11-session@example.com",
        password: "x",
        isActive: true,
        tokenVersion: 0,
      }),
    );
  });

  beforeEach(async () => {
    await sessions().delete({ userId });
    await AppDataSource.getRepository(User).update(
      { id: userId },
      { isActive: true, tokenVersion: 0 },
    );
    user.isActive = true;
    user.tokenVersion = 0;
  });

  afterAll(async () => {
    await sessions().delete({ userId });
    await AppDataSource.getRepository(User).delete({ id: userId });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("issues an opaque refresh token backed by a 90-day session", async () => {
    const tokens = await authSessionService.createSession(user, {
      ipAddress: "203.0.113.7",
      userAgent: "jest",
    });

    expect(tokens.refreshToken).toMatch(/^hrt1\.[0-9a-f-]{36}\.0\.[A-Za-z0-9_-]+$/);
    expect(verifyToken(tokens.accessToken)).toMatchObject({ userId, tokenVersion: 0 });
    expect(tokens.expiresIn).toBe(900);

    const session = await load(tokens.refreshToken);
    expect(session.generation).toBe(0);
    expect(session.ipAddress).toBe("203.0.113.7");
    expect(
      Math.abs(session.expiresAt.getTime() - (Date.now() + SESSION_IDLE_TIMEOUT_MS)),
    ).toBeLessThan(60_000);
  });

  it("rotates the refresh token on every refresh", async () => {
    const first = await authSessionService.createSession(user);
    const second = await authSessionService.refresh(first.refreshToken);
    const third = await authSessionService.refresh(second.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(third.refreshToken).not.toBe(second.refreshToken);
    expect(sessionIdOf(third.refreshToken)).toBe(sessionIdOf(first.refreshToken));
    expect((await load(third.refreshToken)).generation).toBe(2);
  });

  it("slides the session: a refresh pushes expiry to now + 90 days", async () => {
    const tokens = await authSessionService.createSession(user);
    const nearlyOver = new Date(Date.now() + 60_000);
    await sessions().update({ id: sessionIdOf(tokens.refreshToken) }, { expiresAt: nearlyOver });

    await authSessionService.refresh(tokens.refreshToken);

    const session = await load(tokens.refreshToken);
    expect(session.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + SESSION_IDLE_TIMEOUT_MS - 60_000,
    );
  });

  it("rejects a session idle for more than 90 days", async () => {
    const tokens = await authSessionService.createSession(user);
    await sessions().update(
      { id: sessionIdOf(tokens.refreshToken) },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await expectRejected(tokens.refreshToken, "expired");
  });

  it("returns the same rotation when the previous token comes back within the grace window", async () => {
    // A refresh whose response was lost on a weak connection: the client
    // retries with the token it still has and must not be logged out.
    const first = await authSessionService.createSession(user);
    const rotated = await authSessionService.refresh(first.refreshToken);
    const retried = await authSessionService.refresh(first.refreshToken);

    expect(retried.refreshToken).toBe(rotated.refreshToken);
    expect((await load(first.refreshToken)).generation).toBe(1);
    // The session stays healthy.
    await expect(authSessionService.refresh(rotated.refreshToken)).resolves.toBeDefined();
  });

  it("serializes two concurrent refreshes with the same token", async () => {
    const first = await authSessionService.createSession(user);
    const [a, b] = await Promise.all([
      authSessionService.refresh(first.refreshToken),
      authSessionService.refresh(first.refreshToken),
    ]);
    expect(a.refreshToken).toBe(b.refreshToken);
    expect((await load(first.refreshToken)).generation).toBe(1);
  });

  it("revokes the whole family when an old token is reused after the grace window", async () => {
    const first = await authSessionService.createSession(user);
    const second = await authSessionService.refresh(first.refreshToken);
    await sessions().update(
      { id: sessionIdOf(first.refreshToken) },
      { rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1000) },
    );

    await expectRejected(first.refreshToken, "reused");

    const session = await load(first.refreshToken);
    expect(session.revokedReason).toBe("reuse_detected");
    // The legitimate holder of the newest token is logged out too.
    await expectRejected(second.refreshToken, "revoked");
  });

  it("revokes a token two generations old even inside the grace window", async () => {
    const first = await authSessionService.createSession(user);
    const second = await authSessionService.refresh(first.refreshToken);
    await authSessionService.refresh(second.refreshToken);

    await expectRejected(first.refreshToken, "reused");
  });

  it("logout revokes the session", async () => {
    const tokens = await authSessionService.createSession(user);
    await authSessionService.revoke(tokens.refreshToken);
    await expectRejected(tokens.refreshToken, "revoked");
    expect((await load(tokens.refreshToken)).revokedReason).toBe("logout");
    // Idempotent
    await expect(authSessionService.revoke(tokens.refreshToken)).resolves.toBeUndefined();
  });

  it("a password change (tokenVersion bump) revokes existing sessions", async () => {
    const tokens = await authSessionService.createSession(user);
    await AppDataSource.getRepository(User).update({ id: userId }, { tokenVersion: 1 });
    await expectRejected(tokens.refreshToken, "revoked");
    expect((await load(tokens.refreshToken)).revokedReason).toBe("password_changed");
  });

  it("rejects refresh for a deactivated user", async () => {
    const tokens = await authSessionService.createSession(user);
    await AppDataSource.getRepository(User).update({ id: userId }, { isActive: false });
    await expectRejected(tokens.refreshToken, "revoked");
  });

  it("rejects tampered and malformed tokens", async () => {
    const tokens = await authSessionService.createSession(user);
    const [prefix, id, , mac] = tokens.refreshToken.split(".");
    await expectRejected(`${prefix}.${id}.5.${mac}`, "invalid");
    await expectRejected(`${tokens.refreshToken.slice(0, -2)}xx`, "invalid");
    await expectRejected("not-a-token", "invalid");
  });

  describe("legacy JWT refresh tokens (issued before rotation)", () => {
    const legacyToken = (tokenVersion: number, expiresIn: jwt.SignOptions["expiresIn"] = "30d") =>
      jwt.sign(
        { userId, email: user.email, type: "refresh", tokenVersion, sessionId: "sess_legacy" },
        authConfig.jwt.refreshSecret,
        { expiresIn, algorithm: "HS256" },
      );

    it("moves a valid legacy token onto a new rotating session", async () => {
      const tokens = await authSessionService.refresh(legacyToken(0));
      expect(tokens.refreshToken).toMatch(/^hrt1\./);
      expect((await load(tokens.refreshToken)).generation).toBe(0);
    });

    it("rejects a legacy token issued before a password change", async () => {
      await AppDataSource.getRepository(User).update({ id: userId }, { tokenVersion: 3 });
      await expectRejected(legacyToken(0), "revoked");
    });

    it("rejects an expired legacy token", async () => {
      await expectRejected(legacyToken(0, -10), "expired");
    });
  });

  it("deletes sessions that ended more than 30 days ago", async () => {
    const old = await authSessionService.createSession(user);
    const live = await authSessionService.createSession(user);
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await sessions().update({ id: sessionIdOf(old.refreshToken) }, { expiresAt: longAgo });

    await authSessionService.cleanupEndedSessions();

    expect(await sessions().findOne({ where: { id: sessionIdOf(old.refreshToken) } })).toBeNull();
    expect(
      await sessions().findOne({ where: { id: sessionIdOf(live.refreshToken) } }),
    ).not.toBeNull();
  });

  describe("auth.refreshToken procedure", () => {
    const caller = () =>
      authRouter.createCaller({
        user: null,
        organizationId: null,
        req: { headers: {} },
        res: {},
        ipAddress: "203.0.113.9",
        userAgent: "jest",
      } as unknown as Context);

    it("returns a rotated pair", async () => {
      const tokens = await authSessionService.createSession(user);
      const result = await caller().refreshToken({ refreshToken: tokens.refreshToken });
      expect(result.refreshToken).not.toBe(tokens.refreshToken);
      expect(result.accessToken).toBeTruthy();
      expect(result.expiresIn).toBe(900);
    });

    it("answers UNAUTHORIZED for a rejected token (the client logs out)", async () => {
      await expect(caller().refreshToken({ refreshToken: "nope" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("answers INTERNAL_SERVER_ERROR, not UNAUTHORIZED, when the database fails", async () => {
      // A transient outage must never look like a dead session to the client.
      const spy = jest
        .spyOn(authSessionService, "refresh")
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
      await expect(caller().refreshToken({ refreshToken: "whatever" })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
      spy.mockRestore();
    });

    it("logout revokes the session without an access token", async () => {
      const tokens = await authSessionService.createSession(user);
      await caller().logout({ refreshToken: tokens.refreshToken });
      await expectRejected(tokens.refreshToken, "revoked");
    });
  });
});
