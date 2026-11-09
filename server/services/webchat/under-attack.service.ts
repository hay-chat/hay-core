/**
 * D9-10: webchat under-attack mode.
 *
 * While on, every visitor gets the bot challenge before their first message
 * (contributions are forced to `challenge_all`, and gates are told so a
 * missing token is refused). It turns on two ways:
 *  - the owner switches it on in Settings > Webchat;
 *  - automatically, when more than `config.underAttack.createThreshold` distinct
 *    addresses attempt new conversations for one org within the window.
 * Either way it lasts `config.underAttack.hours`, then lapses on its own.
 */

import { IsNull, LessThan, Or } from "typeorm";
import { AppDataSource } from "@server/database/data-source";
import { WebchatSettings } from "@server/database/entities/webchat-settings.entity";
import { webchatSettingsRepository } from "@server/repositories/webchat-settings.repository";
import { rateLimitService } from "@server/services/rate-limit.service";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("under-attack");

export interface UnderAttackState {
  active: boolean;
  until: string | null;
  source: "owner" | "auto" | null;
}

function repository() {
  return AppDataSource.getRepository(WebchatSettings);
}

export function stateOf(
  settings: Pick<WebchatSettings, "underAttackUntil" | "underAttackSource"> | null,
): UnderAttackState {
  const until = settings?.underAttackUntil ?? null;
  const active = !!until && until.getTime() > Date.now();
  return {
    active,
    until: active ? until.toISOString() : null,
    source: active ? (settings?.underAttackSource ?? null) : null,
  };
}

export async function isUnderAttack(organizationId: string): Promise<boolean> {
  const settings = await repository().findOne({
    where: { organizationId },
    select: ["id", "underAttackUntil", "underAttackSource"],
  });
  return stateOf(settings).active;
}

function endsAt(): Date {
  return new Date(Date.now() + config.underAttack.hours * 60 * 60 * 1000);
}

/** Owner toggle. Turning it on (re)starts the full period. */
export async function setUnderAttack(
  organizationId: string,
  enabled: boolean,
): Promise<UnderAttackState> {
  const settings = await webchatSettingsRepository.update(organizationId, {
    underAttackUntil: enabled ? endsAt() : null,
    underAttackSource: enabled ? "owner" : null,
  });
  return stateOf(settings);
}

/**
 * Count one address's conversation-create attempts and switch under-attack
 * mode on when the org passes the threshold of distinct addresses. One client
 * repeating itself counts once, so it cannot turn on the challenge for
 * everyone else (the per-IP limits deal with it). Returns whether the org is
 * under attack. While Redis is down the counts are per process.
 */
export async function recordCreateAttempt(organizationId: string, ip: string): Promise<boolean> {
  const { createThreshold, windowSeconds } = config.underAttack;
  if (createThreshold > 0) {
    const repeat = await rateLimitService.checkKeyRateLimit(
      `under-attack:seen:${organizationId}:${ip}`,
      1,
      windowSeconds,
    );
    if (!repeat.limited) {
      const result = await rateLimitService.checkKeyRateLimit(
        `under-attack:creates:${organizationId}`,
        createThreshold,
        windowSeconds,
      );
      if (result.limited) {
        // Only an org not already under attack is switched on; an owner's
        // longer period is never shortened.
        const update = await repository().update(
          { organizationId, underAttackUntil: Or(IsNull(), LessThan(new Date())) },
          { underAttackUntil: endsAt(), underAttackSource: "auto" },
        );
        if (update.affected) {
          logger.warn(
            { organizationId, createThreshold, windowSeconds },
            "Webchat create rate passed the threshold: under-attack mode on",
          );
        }
        return true;
      }
    }
  }
  return isUnderAttack(organizationId);
}
