import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Minimal Tiptap document model used by this migration. Only the node shapes
 * produced here are represented; this is intentionally not the full Tiptap schema.
 */
interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

/** Editor.js block as stored in legacy instruction columns. */
interface EditorJsBlock {
  type: string;
  data: {
    level?: number;
    text?: string;
    style?: string;
    items?: string[];
  };
}

/** Legacy array-of-instructions format (id, level, instructions). */
interface LegacyInstructionItem {
  instructions?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // This migration is not reversible since we're converting formats
    console.log(
      "WARNING: This migration cannot be reversed. Tiptap format cannot be converted back to Editor.js.",
    );
  }

  private async convertPlaybookInstructions(queryRunner: QueryRunner): Promise<void> {
    // Get all playbooks with instructions
    const playbooks: Array<{ id: string; instructions: unknown }> = await queryRunner.query(
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
    const agents: Array<{
      id: string;
      instructions: unknown;
      human_handoff_available_instructions: unknown;
      human_handoff_unavailable_instructions: unknown;
    }> = await queryRunner.query(
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

  private convertEditorJsToTiptap(instructions: unknown): TiptapDoc | null {
    // If it's already Tiptap format (has type: "doc"), return as-is
    if (isObject(instructions) && instructions.type === "doc") {
      return instructions as unknown as TiptapDoc;
    }

    // If it's Editor.js format (has blocks array)
    if (isObject(instructions) && Array.isArray(instructions.blocks)) {
      const content: TiptapNode[] = [];

      for (const block of instructions.blocks as EditorJsBlock[]) {
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
      const content: TiptapNode[] = [];

      for (const item of instructions as LegacyInstructionItem[]) {
        if (!item.instructions) continue;

        const text = item.instructions;

        // Convert [action](id) to action merge field
        const actionMatches = text.matchAll(/\[action\]\(([^)]+)\)/g);
        const documentMatches = text.matchAll(/\[document\]\(([^)]+)\)/g);

        // Build content array with text and merge fields
        const paragraphContent: TiptapNode[] = [];
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

  private convertEditorJsBlockToTiptap(block: EditorJsBlock): TiptapNode | null {
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

  private parseInlineContent(text: string): TiptapNode[] {
    const content: TiptapNode[] = [];

    // Check for action and document tags
    const actionRegex = /<action[^>]*id=["']([^"']+)["'][^>]*>([^<]*)<\/action>/gi;
    const documentRegex = /<document[^>]*id=["']([^"']+)["'][^>]*>([^<]*)<\/document>/gi;

    let lastIndex = 0;
    const matches: Array<{ index: number; length: number; node: TiptapNode }> = [];

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
