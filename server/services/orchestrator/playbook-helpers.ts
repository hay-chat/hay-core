import { PlaybookService } from "../playbook.service";

/**
 * Helper class for managing playbook operations in the orchestrator.
 * Handles retrieval of active playbooks and applying ender messages.
 */
export class PlaybookHelpers {
  /**
   * Creates a new PlaybookHelpers instance.
   * @param playbookService - Service for managing playbooks
   */
  constructor(private playbookService: PlaybookService) {}

  /**
   * Retrieves an active playbook based on kind, organization, and optional trigger.
   * Falls back to default templates for welcome and ender playbooks if none found.
   * @param kind - The type of playbook to retrieve (e.g., 'welcome', 'ender')
   * @param organizationId - The ID of the organization
   * @param trigger - Optional trigger condition for the playbook
   * @returns The active playbook or a default template
   */
  async getActivePlaybook(
    kind: string,
    organizationId: string,
    trigger?: string
  ): Promise<any> {
    const playbooks = await this.playbookService.getPlaybooks(organizationId);

    // First try org-specific playbook
    let playbook = playbooks.find(
      (p) =>
        p.kind === kind &&
        p.status === "active" &&
        (!trigger || p.trigger === trigger)
    );

    if (!playbook) {
      // TODO: Fallback to system playbooks
      // For now, return a default template
      if (kind === "welcome") {
        return { prompt_template: "Hello! How can I help you today?" };
      } else if (kind === "ender") {
        return {
          prompt_template: "Is there anything else I can help you with?",
        };
      }
    }

    return playbook;
  }

  /**
   * Conditionally appends an ender message to the content based on settings.
   * Ender messages are not added if explicitly disabled or if a status is being set.
   * @param content - The main content to potentially append to
   * @param includeEnder - Whether to include an ender message (undefined defaults to true)
   * @param setStatus - If a status is being set, ender is not added
   * @param organizationId - The ID of the organization
   * @returns The content with or without the ender message appended
   */
  async addEnderIfAppropriate(
    content: string,
    includeEnder: boolean | undefined,
    setStatus: string | undefined,
    organizationId: string
  ): Promise<string> {
    if (includeEnder === false || setStatus) {
      return content;
    }

    console.log(`[Orchestrator] Adding ender message...`);
    const enderPlaybook = await this.getActivePlaybook(
      "ender",
      organizationId
    );
    
    if (enderPlaybook?.prompt_template) {
      return content + "\n\n" + enderPlaybook.prompt_template;
    }

    return content;
  }
}