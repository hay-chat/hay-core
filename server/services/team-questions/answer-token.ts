import { createHmac, timingSafeEqual } from "crypto";
import { config, getDashboardUrl } from "@server/config/env";

/**
 * Signed link for answering a quick check from the team email (D19-5): no
 * login, valid 24 h, for one question and one teammate. It is single use
 * because the question can only be answered once (the answer claims it).
 */

export const ANSWER_LINK_TTL_SECONDS = 24 * 60 * 60;

/** Dedicated key derived from JWT_SECRET, so the token can't be replayed as anything else. */
function signingKey(): Buffer {
  if (!config.jwt.secret) {
    throw new Error("JWT_SECRET is required to sign answer links");
  }
  return createHmac("sha256", config.jwt.secret).update("hay:team-question-answer:v1").digest();
}

function sign(body: string): string {
  return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

export function signAnswerToken(
  questionId: string,
  userId: string,
  now = Date.now(),
  ttlSeconds = ANSWER_LINK_TTL_SECONDS,
): string {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const body = Buffer.from(`${questionId}.${userId}.${expires}`).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyAnswerToken(
  token: unknown,
  now = Date.now(),
): { questionId: string; userId: string } | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const [questionId, userId, expires, rest] = Buffer.from(body, "base64url").toString().split(".");
  if (!questionId || !userId || rest !== undefined || !/^\d{1,12}$/.test(expires ?? "")) {
    return null;
  }
  if (Number(expires) * 1000 < now) return null;
  return { questionId, userId };
}

/** The one-field answer page on the dashboard. */
export function answerLink(questionId: string, userId: string): string {
  return `${getDashboardUrl()}/answer-question?token=${encodeURIComponent(signAnswerToken(questionId, userId))}`;
}
