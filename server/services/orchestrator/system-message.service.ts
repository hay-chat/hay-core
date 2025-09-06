import { Message, MessageType } from "@server/database/entities/message.entity";
import { RagPack, PlaybookState } from "@server/orchestrator/types";
import {
  formatInstructions,
  analyzeInstructions,
  isInstructionsJson,
} from "@server/utils/instruction-formatter";

export class SystemMessageService {
  static createRagSystemMessage(ragPack: RagPack): Partial<Message> {
    const documentsContext = ragPack.results
      .map((result, index) => {
        const title = result.title || `Document ${index + 1}`;
        const source = result.source ? ` (Source: ${result.source})` : "";
        const similarity = result.sim.toFixed(3);

        return `**${title}**${source} (Similarity: ${similarity})
${result.content}`;
      })
      .join("\n\n---\n\n");

    const content = `You have access to the following relevant documents to help answer the user's question. Use this information to provide accurate, detailed, and contextual responses:

${documentsContext}

Guidelines:
- Base your answers primarily on the information provided in these documents
- If the answer cannot be found in these documents, clearly indicate that
- You can reference specific documents by their titles when citing information
- When a source URL is available (starts with http:// or https://), include a link in your response using the format [article title or "Read more"](URL)
- Only link to sources when they are relevant to the information you're presenting and when the tutorial or article contains additional useful information
- Provide comprehensive answers using the full context available

User Query: "${ragPack.query}"
Document Index Version: ${ragPack.version}`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "docqa" as const,
        confidence:
          ragPack.results.length > 0
            ? Math.max(...ragPack.results.map((r) => r.sim))
            : 0,
      } as any,
    };
  }

  static createPlaybookSystemMessage(
    playbook: any,
    toolSchemas?: any[]
  ): Partial<Message> {
    // Analyze instructions to extract actions and documents
    const instructions = playbook.instructions || playbook.prompt_template;
    let instructionText = "";
    let referencedActions: string[] = [];
    let referencedDocuments: string[] = [];

    if (isInstructionsJson(instructions)) {
      const analysis = analyzeInstructions(instructions);
      instructionText = analysis.formattedText;
      referencedActions = analysis.actions;
      referencedDocuments = analysis.documents;
    } else {
      instructionText = formatInstructions(instructions);
    }

    let content = `From this message forward you should be following this playbook:

**Playbook: ${playbook.title}**
${playbook.description ? `\nDescription: ${playbook.description}` : ""}

**Instructions:**
${instructionText}

**Required Fields:**
${
  playbook.required_fields?.length
    ? playbook.required_fields.join(", ")
    : "None"
}

**Trigger:** ${playbook.trigger}`;

    // Add referenced actions if any exist
    if (referencedActions.length > 0) {
      console.log(
        `[SystemMessageService] Processing ${referencedActions.length} referenced actions:`,
        referencedActions
      );
      console.log(
        `[SystemMessageService] Tool schemas available:`,
        toolSchemas?.length || 0,
        toolSchemas?.map((s) => s.name) || []
      );

      content += `\n\n**Referenced Actions:**
      The following tools are available for you to use. You MUST return only valid JSON when calling tools, with no additional text:`;

      // If we have tool schemas, show detailed action information
      if (toolSchemas && toolSchemas.length > 0) {
        const actionDetails = referencedActions.map((actionName) => {
          // Try to find tool schema by direct match or by extracting tool name from prefixed action
          let toolSchema = toolSchemas.find(
            (schema) => schema.name === actionName
          );

          // If not found and action name looks like a plugin-prefixed name, try to extract the tool name
          if (!toolSchema && actionName.includes("_")) {
            const parts = actionName.split("_");
            if (parts.length >= 2) {
              // Try matching with just the last part (tool name)
              const toolName = parts[parts.length - 1];
              toolSchema = toolSchemas.find(
                (schema) => schema.name === toolName
              );

              // If still not found, try matching with everything after the first underscore
              if (!toolSchema) {
                const toolNameSuffix = parts.slice(1).join("_");
                toolSchema = toolSchemas.find(
                  (schema) => schema.name === toolNameSuffix
                );
              }
            }
          }

          console.log(
            `[SystemMessageService] Looking for action "${actionName}", found:`,
            !!toolSchema
          );
          if (toolSchema) {
            console.log(
              `[SystemMessageService] Tool schema for "${actionName}":`,
              toolSchema
            );
            const requiredFields =
              toolSchema.required && toolSchema.required.length > 0
                ? ` (Required: ${toolSchema.required.join(", ")})`
                : "";
            return `- **${actionName}**: ${
              toolSchema.description
            }${requiredFields}\n  Input Schema: ${JSON.stringify(
              toolSchema.parameters || {},
              null,
              2
            )}`;
          } else {
            return `- **${actionName}**: Action not found in available tools`;
          }
        });
        content += `\n${actionDetails.join("\n\n")}`;
      }
    }

    // Add referenced documents if any exist
    if (referencedDocuments.length > 0) {
      content += `\n\n**Referenced Documents:**
${referencedDocuments.map((document) => `- ${document}`).join("\n")}`;
    }

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "playbook",
        playbook_id: playbook.id,
        tools: toolSchemas?.map((s) => s.name) || [],
        referenced_actions: referencedActions,
        referenced_documents: referencedDocuments,
        confidence: 1.0,
      },
    };
  }

  static createPlaybookStateSystemMessage(
    playbookState: PlaybookState
  ): Partial<Message> {
    const content = `Playbook State Update:

**Current Step:** ${playbookState.stepId}
**Playbook ID:** ${playbookState.id}
**Started At:** ${playbookState.startedAt}

**Current Data:**
${JSON.stringify(playbookState.data, null, 2)}

**Step History:**
${playbookState.history
  .map((h) => `- ${h.stepId} at ${h.ts}${h.notes ? ` (${h.notes})` : ""}`)
  .join("\n")}

Continue following the playbook instructions based on this current state.`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "playbook" as const,
        playbook_id: playbookState.id,
        confidence: 1.0,
      } as any,
    };
  }

  static createToolSchemaSystemMessage(toolSchemas: any[]): Partial<Message> {
    const content = `Available Tools Schema:

You have access to the following tools. When calling a tool, you MUST respond with ONLY valid JSON in the exact format specified, with no additional text:

${toolSchemas
  .map(
    (schema) =>
      `**${schema.name}**
Description: ${schema.description || "No description provided"}
Parameters: ${JSON.stringify(schema.parameters, null, 2)}
Required: ${schema.required || []}`
  )
  .join("\n\n---\n\n")}

Response format when calling a tool:
{
  "tool_name": "exact_tool_name",
  "arguments": { 
    // All required parameters and any optional ones you want to include
  }
}`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        tools: toolSchemas.map((s) => s.name),
      } as any,
    };
  }
}
