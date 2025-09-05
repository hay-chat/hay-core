import { Message, MessageType } from "@server/database/entities/message.entity";
import { RagPack, PlaybookState } from "@server/orchestrator/types";

export class SystemMessageService {
  static createRagSystemMessage(ragPack: RagPack): Partial<Message> {
    const documentsContext = ragPack.results
      .map((result, index) => {
        const title = result.title || `Document ${index + 1}`;
        const source = result.source ? ` (Source: ${result.source})` : '';
        const similarity = result.sim.toFixed(3);
        
        return `**${title}**${source} (Similarity: ${similarity})
${result.content}`;
      })
      .join('\n\n---\n\n');

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
        confidence: ragPack.results.length > 0 ? Math.max(...ragPack.results.map(r => r.sim)) : 0
      } as any
    };
  }

  static createPlaybookSystemMessage(playbook: any, toolSchemas?: any[]): Partial<Message> {
    let content = `From this message forward you should be following this playbook:

**Playbook: ${playbook.title}**
${playbook.description ? `\nDescription: ${playbook.description}` : ''}

**Instructions:**
${playbook.instructions || playbook.prompt_template || 'No specific instructions provided.'}

**Required Fields:**
${playbook.required_fields?.length ? playbook.required_fields.join(', ') : 'None'}

**Trigger:** ${playbook.trigger}`;

    if (toolSchemas && toolSchemas.length > 0) {
      content += `\n\n**Available Tools:**
The following tools are available for you to use. You MUST return only valid JSON when calling tools, with no additional text:

${toolSchemas.map(schema => 
  `- **${schema.name}**: ${schema.description || 'No description'}
    Input Schema: ${JSON.stringify(schema.parameters || {}, null, 2)}`
).join('\n\n')}

When calling a tool, respond with ONLY a JSON object in this format:
{
  "tool_name": "tool_name_here",
  "arguments": { /* tool arguments here */ }
}`;
    }

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "playbook",
        playbook_id: playbook.id,
        tools: toolSchemas?.map(s => s.name) || [],
        confidence: 1.0
      }
    };
  }

  static createPlaybookStateSystemMessage(playbookState: PlaybookState): Partial<Message> {
    const content = `Playbook State Update:

**Current Step:** ${playbookState.stepId}
**Playbook ID:** ${playbookState.id}
**Started At:** ${playbookState.startedAt}

**Current Data:**
${JSON.stringify(playbookState.data, null, 2)}

**Step History:**
${playbookState.history.map(h => `- ${h.stepId} at ${h.ts}${h.notes ? ` (${h.notes})` : ''}`).join('\n')}

Continue following the playbook instructions based on this current state.`;

    return {
      content,
      type: MessageType.SYSTEM,
      sender: "system",
      metadata: {
        path: "playbook" as const,
        playbook_id: playbookState.id,
        confidence: 1.0
      } as any
    };
  }

  static createToolSchemaSystemMessage(toolSchemas: any[]): Partial<Message> {
    const content = `Available Tools Schema:

You have access to the following tools. When calling a tool, you MUST respond with ONLY valid JSON in the exact format specified, with no additional text:

${toolSchemas.map(schema => 
  `**${schema.name}**
Description: ${schema.description || 'No description provided'}
Parameters: ${JSON.stringify(schema.parameters, null, 2)}
Required: ${schema.required || []}`
).join('\n\n---\n\n')}

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
        tools: toolSchemas.map(s => s.name)
      } as any
    };
  }
}