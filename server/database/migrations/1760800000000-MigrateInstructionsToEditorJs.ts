import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrateInstructionsToEditorJs1760800000000 implements MigrationInterface {
  name = "MigrateInstructionsToEditorJs1760800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration converts legacy instructions format to Editor.js format
    // For agents and playbooks

    console.log("Converting playbooks instructions to Editor.js format...");
    await this.convertPlaybookInstructions(queryRunner);

    console.log("Converting agents instructions to Editor.js format...");
    await this.convertAgentInstructions(queryRunner);

    console.log("Migration complete!");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is not reversible since we're removing the legacy format
    console.log("WARNING: This migration cannot be reversed. Legacy format is no longer supported.");
  }

  private async convertPlaybookInstructions(queryRunner: QueryRunner): Promise<void> {
    // Get all playbooks with instructions
    const playbooks = await queryRunner.query(
      `SELECT id, instructions FROM playbooks WHERE instructions IS NOT NULL`,
    );

    for (const playbook of playbooks) {
      const convertedInstructions = this.convertToEditorJs(playbook.instructions);

      if (convertedInstructions) {
        await queryRunner.query(
          `UPDATE playbooks SET instructions = $1 WHERE id = $2`,
          [JSON.stringify(convertedInstructions), playbook.id],
        );
      }
    }

    console.log(`Converted ${playbooks.length} playbook(s)`);
  }

  private async convertAgentInstructions(queryRunner: QueryRunner): Promise<void> {
    // Get all agents with instructions
    const agents = await queryRunner.query(
      `SELECT id, instructions, human_handoff_available_instructions, human_handoff_unavailable_instructions FROM agents
       WHERE instructions IS NOT NULL
          OR human_handoff_available_instructions IS NOT NULL
          OR human_handoff_unavailable_instructions IS NOT NULL`,
    );

    for (const agent of agents) {
      const updates: { field: string; value: string }[] = [];

      if (agent.instructions) {
        const converted = this.convertToEditorJs(agent.instructions);
        if (converted) {
          updates.push({ field: "instructions", value: JSON.stringify(converted) });
        }
      }

      if (agent.human_handoff_available_instructions) {
        const converted = this.convertToEditorJs(agent.human_handoff_available_instructions);
        if (converted) {
          updates.push({
            field: "human_handoff_available_instructions",
            value: JSON.stringify(converted),
          });
        }
      }

      if (agent.human_handoff_unavailable_instructions) {
        const converted = this.convertToEditorJs(agent.human_handoff_unavailable_instructions);
        if (converted) {
          updates.push({
            field: "human_handoff_unavailable_instructions",
            value: JSON.stringify(converted),
          });
        }
      }

      // Apply updates
      for (const update of updates) {
        await queryRunner.query(`UPDATE agents SET ${update.field} = $1 WHERE id = $2`, [
          update.value,
          agent.id,
        ]);
      }
    }

    console.log(`Converted ${agents.length} agent(s)`);
  }

  private convertToEditorJs(instructions: any): any | null {
    // If it's already Editor.js format (has blocks array), return as-is
    if (
      instructions &&
      typeof instructions === "object" &&
      Array.isArray(instructions.blocks)
    ) {
      return instructions;
    }

    // If it's a string, convert to a simple paragraph
    if (typeof instructions === "string") {
      return {
        blocks: [
          {
            type: "paragraph",
            data: {
              text: instructions,
            },
          },
        ],
      };
    }

    // If it's the legacy array format with id, level, instructions
    if (Array.isArray(instructions) && instructions.length > 0) {
      // Group items by level to create a hierarchical structure
      const blocks: any[] = [];
      let currentListItems: string[] = [];
      let currentLevel = 0;

      for (const item of instructions) {
        if (!item.instructions) continue;

        const level = item.level || 0;
        let text = item.instructions;

        // Convert [action](id) to <action id="id">action</action>
        text = text.replace(/\[action\]\(([^)]+)\)/g, '<action id="$1">action</action>');

        // Convert [document](id) to <document id="id">document</document>
        text = text.replace(/\[document\]\(([^)]+)\)/g, '<document id="$1">document</document>');

        // If this is a new level or first item, create a list block
        if (level !== currentLevel && currentListItems.length > 0) {
          blocks.push({
            type: "list",
            data: {
              style: "ordered",
              items: currentListItems,
            },
          });
          currentListItems = [];
        }

        currentListItems.push(text);
        currentLevel = level;
      }

      // Add final list block
      if (currentListItems.length > 0) {
        blocks.push({
          type: "list",
          data: {
            style: "ordered",
            items: currentListItems,
          },
        });
      }

      return {
        blocks,
      };
    }

    return null;
  }
}
