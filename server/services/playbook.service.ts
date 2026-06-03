import { PlaybookRepository } from "../repositories/playbook.repository";
import { PlaybookVersionRepository } from "../repositories/playbook-version.repository";
import { AgentRepository } from "../repositories/agent.repository";
import { OrganizationRepository } from "../repositories/organization.repository";
import { Playbook, PlaybookStatus } from "../database/entities/playbook.entity";
import {
  PlaybookVersion,
  PlaybookVersionStatus,
} from "../database/entities/playbook-version.entity";
import type { PlaybookInstructions } from "../database/entities/playbook.entity";
import { Agent } from "../database/entities/agent.entity";
import { AppDataSource } from "../database/data-source";

export class PlaybookService {
  private playbookRepository: PlaybookRepository;
  private playbookVersionRepository: PlaybookVersionRepository;
  private agentRepository: AgentRepository;
  private organizationRepository: OrganizationRepository;

  constructor() {
    this.playbookRepository = new PlaybookRepository();
    this.playbookVersionRepository = new PlaybookVersionRepository();
    this.agentRepository = new AgentRepository();
    this.organizationRepository = new OrganizationRepository();
  }

  async createPlaybook(
    organizationId: string,
    data: {
      title: string;
      trigger: string;
      description?: string;
      instructions?: PlaybookInstructions;
      status?: PlaybookStatus;
      agentIds?: string[];
    },
  ): Promise<Playbook> {
    const { agentIds, ...playbookData } = data;

    const agents: Agent[] = [];
    if (agentIds && agentIds.length > 0) {
      for (const agentId of agentIds) {
        const agent = await this.agentRepository.findById(agentId);
        if (!agent || agent.organization_id !== organizationId) continue;
        agents.push(agent);
      }
    } else {
      // Auto-assign the organization's default agent when no agents are specified
      const organization = await this.organizationRepository.findById(organizationId);
      if (organization?.defaultAgentId) {
        const defaultAgent = await this.agentRepository.findById(organization.defaultAgentId);
        if (defaultAgent) {
          agents.push(defaultAgent);
        }
      }
    }

    const playbook = await this.playbookRepository.create({
      ...playbookData,
      organization_id: organizationId,
      agents,
    });

    // Create initial version (v1) with the playbook's instructions
    const versionStatus =
      playbook.status === PlaybookStatus.ACTIVE
        ? PlaybookVersionStatus.ACTIVE
        : PlaybookVersionStatus.DRAFT;

    const version = await this.playbookVersionRepository.create({
      playbook_id: playbook.id,
      version_number: 1,
      status: versionStatus,
      instructions: playbook.instructions,
      prompt_template: playbook.prompt_template,
      required_fields: playbook.required_fields,
    });

    // Set the version pointer on the playbook
    const pointerUpdate: Partial<Playbook> =
      versionStatus === PlaybookVersionStatus.ACTIVE
        ? { active_version_id: version.id }
        : { draft_version_id: version.id };

    await this.playbookRepository.update(playbook.id, organizationId, pointerUpdate);

    return playbook;
  }

  async getPlaybooks(organizationId: string): Promise<Playbook[]> {
    return await this.playbookRepository.findByOrganization(organizationId);
  }

  async getPlaybooksByStatus(organizationId: string, status: PlaybookStatus): Promise<Playbook[]> {
    return await this.playbookRepository.findByStatus(organizationId, status);
  }

  async getPlaybook(organizationId: string, playbookId: string): Promise<Playbook | null> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      return null;
    }
    return playbook;
  }

  async updatePlaybook(
    organizationId: string,
    playbookId: string,
    data: {
      title?: string;
      trigger?: string;
      description?: string;
      instructions?: PlaybookInstructions;
      status?: PlaybookStatus;
      agentIds?: string[];
    },
  ): Promise<Playbook | null> {
    const { agentIds, ...updateData } = data;

    let agents: Agent[] | undefined;
    if (agentIds !== undefined) {
      agents = [];
      for (const agentId of agentIds) {
        const agent = await this.agentRepository.findById(agentId);
        if (!agent || agent.organization_id !== organizationId) continue;
        if (agent) {
          agents.push(agent);
        }
      }
    }

    return await this.playbookRepository.update(playbookId, organizationId, {
      ...updateData,
      ...(agents !== undefined && { agents }),
    });
  }

  async deletePlaybook(organizationId: string, playbookId: string): Promise<boolean> {
    return await this.playbookRepository.delete(playbookId, organizationId);
  }

  async addAgentToPlaybook(
    organizationId: string,
    playbookId: string,
    agentId: string,
  ): Promise<Playbook | null> {
    const agent = await this.agentRepository.findById(agentId);
    if (!agent || agent.organization_id !== organizationId) {
      throw new Error("Agent not found");
    }

    return await this.playbookRepository.addAgent(playbookId, agentId, organizationId);
  }

  async removeAgentFromPlaybook(
    organizationId: string,
    playbookId: string,
    agentId: string,
  ): Promise<Playbook | null> {
    return await this.playbookRepository.removeAgent(playbookId, agentId, organizationId);
  }

  async getActivePlaybook(
    kind: string,
    organizationId: string,
    trigger?: string,
  ): Promise<Playbook | null> {
    const playbooks = await this.playbookRepository.findByOrganization(organizationId);

    // First try org-specific playbook
    const playbook = playbooks.find(
      (p) =>
        p.kind === kind &&
        p.status === PlaybookStatus.ACTIVE &&
        (!trigger || p.trigger === trigger),
    );

    if (!playbook) {
      // TODO: Fallback to system playbooks
      // For now, return null
      return null;
    }

    return playbook;
  }

  // --- Version management methods ---

  async getVersions(organizationId: string, playbookId: string): Promise<PlaybookVersion[]> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }
    return await this.playbookVersionRepository.findByPlaybookId(playbookId);
  }

  async getVersion(
    organizationId: string,
    playbookId: string,
    versionId: string,
  ): Promise<PlaybookVersion | null> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }
    const version = await this.playbookVersionRepository.findById(versionId);
    if (!version || version.playbook_id !== playbookId) {
      return null;
    }
    return version;
  }

  async getDraft(organizationId: string, playbookId: string): Promise<PlaybookVersion | null> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }
    return await this.playbookVersionRepository.findDraftByPlaybookId(playbookId);
  }

  async createDraft(
    organizationId: string,
    playbookId: string,
    userId: string,
  ): Promise<PlaybookVersion> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }

    // Check if a draft already exists
    const existingDraft = await this.playbookVersionRepository.findDraftByPlaybookId(playbookId);
    if (existingDraft) {
      return existingDraft;
    }

    // Create draft from active version's data (or empty if no active version)
    const activeVersion = await this.playbookVersionRepository.findActiveByPlaybookId(playbookId);
    const nextNumber = await this.playbookVersionRepository.getNextVersionNumber(playbookId);

    const draft = await this.playbookVersionRepository.create({
      playbook_id: playbookId,
      version_number: nextNumber,
      status: PlaybookVersionStatus.DRAFT,
      instructions: activeVersion?.instructions ?? playbook.instructions,
      prompt_template: activeVersion?.prompt_template ?? playbook.prompt_template,
      required_fields: activeVersion?.required_fields ?? playbook.required_fields,
      created_by_id: userId,
    });

    await this.playbookRepository.update(playbookId, organizationId, {
      draft_version_id: draft.id,
    } as Partial<Playbook>);

    return draft;
  }

  async saveDraft(
    organizationId: string,
    playbookId: string,
    data: {
      instructions?: PlaybookInstructions;
      promptTemplate?: string;
      requiredFields?: string[];
    },
    userId: string,
  ): Promise<PlaybookVersion> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }

    // Get or create draft
    let draft = await this.playbookVersionRepository.findDraftByPlaybookId(playbookId);
    if (!draft) {
      draft = await this.createDraft(organizationId, playbookId, userId);
    }

    // Update draft with new data
    const updateData: Partial<PlaybookVersion> = {};
    if (data.instructions !== undefined) updateData.instructions = data.instructions;
    if (data.promptTemplate !== undefined) updateData.prompt_template = data.promptTemplate;
    if (data.requiredFields !== undefined) updateData.required_fields = data.requiredFields;

    const updated = await this.playbookVersionRepository.update(draft.id, updateData);
    if (!updated) {
      throw new Error("Failed to update draft");
    }
    return updated;
  }

  async publishDraft(
    organizationId: string,
    playbookId: string,
    userId: string,
    note?: string,
  ): Promise<PlaybookVersion> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }

    const draft = await this.playbookVersionRepository.findDraftByPlaybookId(playbookId);
    if (!draft) {
      throw new Error("No draft to publish");
    }

    return await AppDataSource.transaction(async () => {
      // 1. Archive current active version
      await this.playbookVersionRepository.archiveActiveByPlaybookId(playbookId);

      // 2. Create new active version from draft data
      const nextNumber = await this.playbookVersionRepository.getNextVersionNumber(playbookId);
      const newActive = await this.playbookVersionRepository.create({
        playbook_id: playbookId,
        version_number: nextNumber,
        status: PlaybookVersionStatus.ACTIVE,
        instructions: draft.instructions,
        prompt_template: draft.prompt_template,
        required_fields: draft.required_fields,
        publish_note: note || null,
        created_by_id: draft.created_by_id,
        published_by_id: userId,
        published_at: new Date(),
      });

      // 3. Delete the draft
      await this.playbookVersionRepository.deleteDraftByPlaybookId(playbookId);

      // 4. Sync versioned fields to playbook row (materialized view)
      await this.playbookRepository.update(playbookId, organizationId, {
        instructions: draft.instructions,
        prompt_template: draft.prompt_template,
        required_fields: draft.required_fields,
        active_version_id: newActive.id,
        draft_version_id: null,
        status: PlaybookStatus.ACTIVE,
      } as Partial<Playbook>);

      return newActive;
    });
  }

  async rollbackToVersion(
    organizationId: string,
    playbookId: string,
    versionId: string,
    userId: string,
    reason?: string,
  ): Promise<PlaybookVersion> {
    const playbook = await this.playbookRepository.findById(playbookId);
    if (!playbook || playbook.organization_id !== organizationId) {
      throw new Error("Playbook not found");
    }

    const targetVersion = await this.playbookVersionRepository.findById(versionId);
    if (!targetVersion || targetVersion.playbook_id !== playbookId) {
      throw new Error("Version not found");
    }

    return await AppDataSource.transaction(async () => {
      // 1. Archive current active version
      await this.playbookVersionRepository.archiveActiveByPlaybookId(playbookId);

      // 2. Delete existing draft (rollback invalidates it)
      await this.playbookVersionRepository.deleteDraftByPlaybookId(playbookId);

      // 3. Create new active version cloned from target
      const nextNumber = await this.playbookVersionRepository.getNextVersionNumber(playbookId);
      const newActive = await this.playbookVersionRepository.create({
        playbook_id: playbookId,
        version_number: nextNumber,
        status: PlaybookVersionStatus.ACTIVE,
        instructions: targetVersion.instructions,
        prompt_template: targetVersion.prompt_template,
        required_fields: targetVersion.required_fields,
        publish_note: reason || `Rolled back to version ${targetVersion.version_number}`,
        created_by_id: userId,
        published_by_id: userId,
        published_at: new Date(),
      });

      // 4. Sync versioned fields to playbook row
      await this.playbookRepository.update(playbookId, organizationId, {
        instructions: targetVersion.instructions,
        prompt_template: targetVersion.prompt_template,
        required_fields: targetVersion.required_fields,
        active_version_id: newActive.id,
        draft_version_id: null,
        status: PlaybookStatus.ACTIVE,
      } as Partial<Playbook>);

      return newActive;
    });
  }
}
