/**
 * The organization's AI assistant: one per organization, configured on the
 * organization itself (name, persona, greeting, hand-off settings).
 */
import type { Organization } from "@server/entities/organization.entity";
import type { PlaybookInstructions } from "@server/database/entities/playbook.entity";
import { analyzeTiptapInstructions } from "@server/utils/tiptap-formatter";
import { asTiptapDocument } from "@server/services/playbook-instructions-text";

type AssistantPersona = Pick<
  Organization,
  "assistantName" | "assistantTone" | "assistantAvoid" | "assistantInstructions"
>;

/**
 * The system message that gives the assistant its persona, or null when the
 * organization has not described one (no name, tone, avoid or instructions).
 */
export function buildAssistantInstructions(organization: AssistantPersona): string | null {
  const lines: string[] = [];

  if (organization.assistantName?.trim()) {
    lines.push(`You are the assistant: ${organization.assistantName.trim()}`);
  }
  if (organization.assistantTone?.trim()) {
    lines.push(`Your tone should be: ${organization.assistantTone.trim()}`);
  }
  if (organization.assistantAvoid?.trim()) {
    lines.push(`You should avoid: ${organization.assistantAvoid.trim()}`);
  }
  if (organization.assistantInstructions) {
    // Plain-text and legacy instructions become paragraphs (asTiptapDocument);
    // the analyzer takes a looser shape, hence the parameter type.
    const doc = asTiptapDocument(
      organization.assistantInstructions as PlaybookInstructions,
    ) as Parameters<typeof analyzeTiptapInstructions>[0];
    const { formattedText } = analyzeTiptapInstructions(doc);
    if (formattedText) lines.push(`Here are some general instructions: ${formattedText}`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}
