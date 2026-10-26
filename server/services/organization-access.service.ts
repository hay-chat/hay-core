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
}

export const organizationAccessService = new OrganizationAccessService();
