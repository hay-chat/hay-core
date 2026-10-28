import { AppDataSource } from "@server/database/data-source";
import { Organization } from "@server/entities/organization.entity";
import type {
  AccessNotice,
  AgentPauseReason,
  OrganizationAccessState,
  SuspensionReason,
} from "@server/types/organization-access.types";
import { auditLogService } from "@server/services/audit-log.service";
import { websocketService } from "@server/services/websocket.service";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("organization-access");

export interface SetAccessStateInput {
  organizationId: string;
  /** `null` lifts the suspension. */
  suspension: { reason: SuspensionReason; redirectUrl?: string } | null;
  /** `null` resumes the AI agent. */
  agentPause: { reason: AgentPauseReason } | null;
  /** `null` clears the dashboard notice. */
  notice: AccessNotice | null;
}

/** WebSocket event sent to every connected dashboard of the organization. */
export const ORGANIZATION_ACCESS_CHANGED_EVENT = "organization_access_changed";

export function toAccessState(organization: Organization): OrganizationAccessState {
  return {
    suspendedAt: organization.suspendedAt ?? null,
    suspensionReason: organization.suspensionReason ?? null,
    suspensionRedirectUrl: organization.suspensionRedirectUrl ?? null,
    agentPausedAt: organization.agentPausedAt ?? null,
    agentPauseReason: organization.agentPauseReason ?? null,
    accessNotice: organization.accessNotice ?? null,
    billingPeriod:
      organization.billingPeriodStart && organization.billingPeriodEnd
        ? { start: organization.billingPeriodStart, end: organization.billingPeriodEnd }
        : null,
    aiPausedAt: organization.aiPausedAt ?? null,
    aiPausedByUserId: organization.aiPausedByUserId ?? null,
  };
}

class OrganizationAccessService {
  private get repository() {
    return AppDataSource.getRepository(Organization);
  }

  async getAccessState(organizationId: string): Promise<OrganizationAccessState | null> {
    const organization = await this.repository.findOneBy({ id: organizationId });
    return organization ? toAccessState(organization) : null;
  }

  /**
   * Write the whole access state in one go. Idempotent: an already-suspended
   * (or already-paused) organization keeps its original timestamp so the age
   * is preserved across repeated syncs from the operator.
   */
  async setAccessState(input: SetAccessStateInput): Promise<OrganizationAccessState | null> {
    const organization = await this.repository.findOneBy({ id: input.organizationId });
    if (!organization) {
      return null;
    }

    const wasSuspended = !!organization.suspendedAt;
    const wasPaused = !!organization.agentPausedAt;

    if (input.suspension) {
      organization.suspendedAt = organization.suspendedAt ?? new Date();
      organization.suspensionReason = input.suspension.reason;
      organization.suspensionRedirectUrl = input.suspension.redirectUrl ?? null;
    } else {
      organization.suspendedAt = null;
      organization.suspensionReason = null;
      organization.suspensionRedirectUrl = null;
    }
    if (input.agentPause) {
      organization.agentPausedAt = organization.agentPausedAt ?? new Date();
      organization.agentPauseReason = input.agentPause.reason;
    } else {
      organization.agentPausedAt = null;
      organization.agentPauseReason = null;
    }
    organization.accessNotice = input.notice;

    await this.repository.save(organization);
    const state = toAccessState(organization);

    try {
      await auditLogService.log({
        organizationId: organization.id,
        action: "organization.access_state_changed",
        metadata: {
          source: "internal",
          suspended: !!state.suspendedAt,
          reason: state.suspensionReason,
          agentPaused: !!state.agentPausedAt,
          agentPauseReason: state.agentPauseReason,
          noticeKey: state.accessNotice?.key ?? null,
        },
      });
    } catch (error) {
      logger.error(
        { err: error, organizationId: organization.id },
        "Failed to audit access change",
      );
    }

    websocketService.sendToOrganization(organization.id, {
      type: ORGANIZATION_ACCESS_CHANGED_EVENT,
      payload: state,
    });

    logger.info(
      {
        organizationId: organization.id,
        suspended: !!state.suspendedAt,
        reason: state.suspensionReason,
        agentPaused: !!state.agentPausedAt,
        agentPauseReason: state.agentPauseReason,
        changed: wasSuspended !== !!state.suspendedAt || wasPaused !== !!state.agentPausedAt,
      },
      "Organization access state updated",
    );

    return state;
  }

  /**
   * Store the operator's current billing period. The operator re-sends it on
   * every usage run, so only a change is written and logged.
   */
  async setBillingPeriod(input: {
    organizationId: string;
    period: { start: Date; end: Date } | null;
  }): Promise<OrganizationAccessState | null> {
    const organization = await this.repository.findOneBy({ id: input.organizationId });
    if (!organization) return null;

    const start = input.period?.start ?? null;
    const end = input.period?.end ?? null;
    const changed =
      (organization.billingPeriodStart?.getTime() ?? null) !== (start?.getTime() ?? null) ||
      (organization.billingPeriodEnd?.getTime() ?? null) !== (end?.getTime() ?? null);
    if (changed) {
      organization.billingPeriodStart = start;
      organization.billingPeriodEnd = end;
      await this.repository.update(
        { id: organization.id },
        { billingPeriodStart: start, billingPeriodEnd: end },
      );
      logger.info(
        { organizationId: organization.id, start, end },
        "Organization billing period updated",
      );
    }
    return toAccessState(organization);
  }

  /**
   * Plan limits the operator sets (Lane A4): today the monthly simulation
   * allowance. Merged into `organization.limits`; null removes it (core
   * default applies). Re-sent on every usage run, so only a change is written.
   */
  async setLimits(input: {
    organizationId: string;
    maxSimulationsPerMonth: number | null;
  }): Promise<Organization["limits"] | null> {
    const organization = await this.repository.findOneBy({ id: input.organizationId });
    if (!organization) return null;

    const current = organization.limits?.maxSimulationsPerMonth ?? null;
    if (current === input.maxSimulationsPerMonth) return organization.limits ?? {};

    const limits = { ...(organization.limits ?? {}) };
    if (input.maxSimulationsPerMonth === null) delete limits.maxSimulationsPerMonth;
    else limits.maxSimulationsPerMonth = input.maxSimulationsPerMonth;
    await this.repository.update({ id: organization.id }, { limits });
    logger.info(
      {
        organizationId: organization.id,
        maxSimulationsPerMonth: { from: current, to: input.maxSimulationsPerMonth },
      },
      "Organization limits updated by the operator",
    );
    return limits;
  }

  /**
   * The owner's "Pause AI everywhere" (D11-9). Pausing keeps the original
   * timestamp and author when already paused. Audited with who did it, and
   * pushed to every open dashboard so the banner appears everywhere at once.
   */
  async setOwnerAiPause(input: {
    organizationId: string;
    userId: string;
    paused: boolean;
  }): Promise<OrganizationAccessState | null> {
    const organization = await this.repository.findOneBy({ id: input.organizationId });
    if (!organization) return null;

    const wasPaused = !!organization.aiPausedAt;
    if (input.paused && !wasPaused) {
      organization.aiPausedAt = new Date();
      organization.aiPausedByUserId = input.userId;
    } else if (!input.paused) {
      organization.aiPausedAt = null;
      organization.aiPausedByUserId = null;
    }
    await this.repository.update(
      { id: organization.id },
      { aiPausedAt: organization.aiPausedAt, aiPausedByUserId: organization.aiPausedByUserId },
    );
    const state = toAccessState(organization);

    if (wasPaused !== input.paused) {
      try {
        await auditLogService.log({
          organizationId: organization.id,
          userId: input.userId,
          action: input.paused ? "organization.ai_paused" : "organization.ai_resumed",
          resource: "organization",
          metadata: { source: "dashboard" },
        });
      } catch (error) {
        logger.error(
          { err: error, organizationId: organization.id },
          "Failed to audit AI pause change",
        );
      }
      websocketService.sendToOrganization(organization.id, {
        type: ORGANIZATION_ACCESS_CHANGED_EVENT,
        payload: state,
      });
      logger.info(
        { organizationId: organization.id, userId: input.userId, paused: input.paused },
        "Owner AI pause changed",
      );
    }

    return state;
  }
}

export const organizationAccessService = new OrganizationAccessService();
