import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrateInstructionsToTiptap1760880508000 implements MigrationInterface {
  name = "MigrateInstructionsToTiptap1760880508000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // This migration converts Editor.js format to Tiptap format
    // For agents and playbooks

    console.log("Converting playbooks instructions to Tiptap format...");
    await this.convertPlaybookInstructions(queryRunner);

    console.log("Converting agents instructions to Tiptap format...");
    await this.convertAgentInstructions(queryRunner);

    console.log("Migration complete!");
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is not reversible since we're converting formats
    console.log(
      "WARNING: This migration cannot be reversed. Tiptap format cannot be converted back to Editor.js.",
    );
  }

  private async convertPlaybookInstructions(queryRunner: QueryRunner): Promise<void> {
    // Get all playbooks with instructions
    const playbooks = await queryRunner.query(
      `SELECT id, instructions FROM playbooks WHERE instructions IS NOT NULL`,
    );

    for (const playbook of playbooks) {
      const convertedInstructions = this.convertEditorJsToTiptap(playbook.instructions);

      if (convertedInstructions) {
        await queryRunner.query(`UPDATE playbooks SET instructions = $1 WHERE id = $2`, [
          JSON.stringify(convertedInstructions),
          playbook.id,
        ]);
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
        const converted = this.convertEditorJsToTiptap(agent.instructions);
        if (converted) {
          updates.push({ field: "instructions", value: JSON.stringify(converted) });
        }
      }

      if (agent.human_handoff_available_instructions) {
        const converted = this.convertEditorJsToTiptap(agent.human_handoff_available_instructions);
        if (converted) {
          updates.push({
            field: "human_handoff_available_instructions",
            value: JSON.stringify(converted),
          });
        }
      }

      if (agent.human_handoff_unavailable_instructions) {
        const converted = this.convertEditorJsToTiptap(
          agent.human_handoff_unavailable_instructions,
        );
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

  private convertEditorJsToTiptap(instructions: any): any | null {
    // If it's already Tiptap format (has type: "doc"), return as-is
    if (instructions && typeof instructions === "object" && instructions.type === "doc") {
      return instructions;
    }

    // If it's Editor.js format (has blocks array)
    if (
      instructions &&
      typeof instructions === "object" &&
      Array.isArray(instructions.blocks)
    ) {
      const content: any[] = [];

      for (const block of instructions.blocks) {
        const tiptapNode = this.convertEditorJsBlockToTiptap(block);
        if (tiptapNode) {
          content.push(tiptapNode);
        }
      }

      return {
        type: "doc",
        content,
      };
    }

    // If it's a string, convert to a simple paragraph
    if (typeof instructions === "string") {
      return {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: instructions,
              },
            ],
          },
        ],
      };
    }

    // If it's the legacy array format with id, level, instructions
    if (Array.isArray(instructions) && instructions.length > 0) {
      const content: any[] = [];

      for (const item of instructions) {
        if (!item.instructions) continue;

        let text = item.instructions;

        // Convert [action](id) to action merge field
        const actionMatches = text.matchAll(/\[action\]\(([^)]+)\)/g);
        const documentMatches = text.matchAll(/\[document\]\(([^)]+)\)/g);

        // Build content array with text and merge fields
        const paragraphContent: any[] = [];
        let lastIndex = 0;

        // Process actions
        for (const match of actionMatches) {
          if (match.index !== undefined && match.index > lastIndex) {
            paragraphContent.push({
              type: "text",
              text: text.slice(lastIndex, match.index),
            });
          }

          paragraphContent.push({
            type: "actionMergeField",
            attrs: {
              id: match[1],
              name: "action",
            },
          });

          lastIndex = match.index! + match[0].length;
        }

        // Process documents
        for (const match of documentMatches) {
          if (match.index !== undefined && match.index > lastIndex) {
            paragraphContent.push({
              type: "text",
              text: text.slice(lastIndex, match.index),
            });
          }

          paragraphContent.push({
            type: "documentMergeField",
            attrs: {
              id: match[1],
              name: "document",
            },
          });

          lastIndex = match.index! + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
          paragraphContent.push({
            type: "text",
            text: text.slice(lastIndex),
          });
        }

        // If no matches, just add plain text
        if (paragraphContent.length === 0) {
          paragraphContent.push({
            type: "text",
            text,
          });
        }

        content.push({
          type: "paragraph",
          content: paragraphContent,
        });
      }

      return {
        type: "doc",
        content,
      };
    }

    return null;
  }

  private convertEditorJsBlockToTiptap(block: any): any | null {
    switch (block.type) {
      case "header": {
        const level = block.data.level || 1;
        const text = this.stripHTML(block.data.text || "");
        const content = this.parseInlineContent(text);

        return {
          type: "heading",
          attrs: {
            level,
          },
          content,
        };
      }

      case "paragraph": {
        const text = this.stripHTML(block.data.text || "");
        const content = this.parseInlineContent(text);

        return {
          type: "paragraph",
          content,
        };
      }

      case "list": {
        const style = block.data.style || "ordered";
        const items = block.data.items || [];

        const listItems = items.map((item: string) => {
          const text = this.stripHTML(item);
          const content = this.parseInlineContent(text);

          return {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content,
              },
            ],
          };
        });

        return {
          type: style === "ordered" ? "orderedList" : "bulletList",
          content: listItems,
        };
      }

      default:
        return null;
    }
  }

  private stripHTML(html: string): string {
    // Remove HTML tags while preserving content
    return html.replace(/<[^>]*>/g, "");
  }

  private parseInlineContent(text: string): any[] {
    const content: any[] = [];

    // Check for action and document tags
    const actionRegex = /<action[^>]*id=["']([^"']+)["'][^>]*>([^<]*)<\/action>/gi;
    const documentRegex = /<document[^>]*id=["']([^"']+)["'][^>]*>([^<]*)<\/document>/gi;

    let lastIndex = 0;
    const matches: Array<{ index: number; length: number; node: any }> = [];

    // Find all action matches
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        node: {
          type: "actionMergeField",
          attrs: {
            id: match[1],
            name: match[2] || "action",
          },
        },
      });
    }

    // Find all document matches
    while ((match = documentRegex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        node: {
          type: "documentMergeField",
          attrs: {
            id: match[1],
            name: match[2] || "document",
          },
        },
      });
    }

    // Sort matches by index
    matches.sort((a, b) => a.index - b.index);

    // Build content array
    for (const match of matches) {
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore) {
          content.push({
            type: "text",
            text: textBefore,
          });
        }
      }

      content.push(match.node);
      lastIndex = match.index + match.length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const textAfter = text.slice(lastIndex);
      if (textAfter) {
        content.push({
          type: "text",
          text: textAfter,
        });
      }
    }

    // If no matches found, return plain text
    if (content.length === 0 && text) {
      content.push({
        type: "text",
        text,
      });
    }

    return content;
  }
}
