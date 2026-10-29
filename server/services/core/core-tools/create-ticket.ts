/**
 * `create_ticket` core tool: raise a helpdesk ticket when a hand-off finds
 * nobody available and the agent is set to "create a ticket". Only works while
 * the conversation's hand-off asked for one (services/handoff-tickets).
 */

import { handoffTicketsService } from "@server/services/handoff-tickets/handoff-tickets.service";
import type { CoreToolDefinition } from "./index";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const createTicketTool: CoreToolDefinition = {
  name: "create_ticket",
  description:
    "Only when your hand-off instructions say to raise a ticket: create a ticket for the team in the " +
    "store's helpdesk. Returns what is still missing (e.g. the customer's email address), or confirms the ticket.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "summary"],
    properties: {
      subject: { type: "string", description: "One line, in the customer's language." },
      summary: {
        type: "string",
        description:
          "For the team: what the customer needs, what was already checked or tried, and the details they gave.",
      },
      email: {
        type: "string",
        description: "The customer's email address, if they typed it in this conversation.",
      },
      name: { type: "string", description: "The customer's name, if they gave it." },
    },
  },

  async execute(conversation, args) {
    return handoffTicketsService.raise(conversation, {
      subject: text(args.subject),
      summary: text(args.summary),
      email: text(args.email),
      name: text(args.name),
    });
  },
};
