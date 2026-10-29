import { z } from "zod";

/**
 * "When no one is available → create a ticket" on an agent: which helpdesk
 * plugin (one declaring the `tickets` capability) and the values the merchant
 * prefilled from that plugin's form. Null on the agent = follow the free-text
 * instructions instead.
 */
export const handoffTicketConfigSchema = z.object({
  pluginId: z.string().trim().min(1).max(255),
  fields: z
    .record(
      z.string().max(120),
      z.union([
        z.string().max(2000),
        z.number(),
        z.boolean(),
        z.array(z.string().max(500)).max(100),
      ]),
    )
    .refine((fields) => Object.keys(fields).length <= 100, { message: "Too many fields" })
    .default({}),
});

export type HandoffTicketConfig = z.infer<typeof handoffTicketConfigSchema>;

/** `conversation.metadata.handoffTicket`: set when the hand-off asks for a ticket. */
export interface HandoffTicketState {
  pluginId: string;
  status: "requested" | "created";
  ticketId?: string;
  ticketUrl?: string | null;
  createdAt?: string;
}
