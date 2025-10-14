import { z } from 'zod';
    import { zendeskClient } from '../zendesk-client.js';

    export const ticketsTools = [
      {
        name: "list_tickets",
        description: "List tickets in Zendesk",
        schema: {
          page: z.number().optional().describe("Page number for pagination"),
          per_page: z.number().optional().describe("Number of tickets per page (max 100)"),
          sort_by: z.string().optional().describe("Field to sort by"),
          sort_order: z.enum(["asc", "desc"]).optional().describe("Sort order (asc or desc)")
        },
        handler: async ({ page, per_page, sort_by, sort_order }) => {
          try {
            const params = { page, per_page, sort_by, sort_order };
            const result = await zendeskClient.listTickets(params);
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error listing tickets: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "get_ticket",
        description: "Get a specific ticket by ID",
        schema: {
          id: z.number().describe("Ticket ID")
        },
        handler: async ({ id }) => {
          try {
            const result = await zendeskClient.getTicket(id);
            return {
              content: [{ 
                type: "text", 
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "create_ticket",
        description: "Create a new ticket",
        schema: {
          subject: z.string().describe("Ticket subject"),
          comment: z.string().describe("Ticket comment/description"),
          priority: z.enum(["urgent", "high", "normal", "low"]).optional().describe("Ticket priority"),
          status: z.enum(["new", "open", "pending", "hold", "solved", "closed"]).optional().describe("Ticket status"),
          requester_id: z.number().optional().describe("User ID of the requester"),
          assignee_id: z.number().optional().describe("User ID of the assignee"),
          group_id: z.number().optional().describe("Group ID for the ticket"),
          type: z.enum(["problem", "incident", "question", "task"]).optional().describe("Ticket type"),
          tags: z.array(z.string()).optional().describe("Tags for the ticket")
        },
        handler: async ({ subject, comment, priority, status, requester_id, assignee_id, group_id, type, tags }) => {
          try {
            const ticketData = {
              subject,
              comment: { body: comment },
              priority,
              status,
              requester_id,
              assignee_id,
              group_id,
              type,
              tags
            };
            
            const result = await zendeskClient.createTicket(ticketData);
            return {
              content: [{ 
                type: "text", 
                text: `Ticket created successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error creating ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "update_ticket",
        description: "Update an existing ticket",
        schema: {
          id: z.number().describe("Ticket ID to update"),
          subject: z.string().optional().describe("Updated ticket subject"),
          comment: z.string().optional().describe("New comment to add"),
          priority: z.enum(["urgent", "high", "normal", "low"]).optional().describe("Updated ticket priority"),
          status: z.enum(["new", "open", "pending", "hold", "solved", "closed"]).optional().describe("Updated ticket status"),
          assignee_id: z.number().optional().describe("User ID of the new assignee"),
          group_id: z.number().optional().describe("New group ID for the ticket"),
          type: z.enum(["problem", "incident", "question", "task"]).optional().describe("Updated ticket type"),
          tags: z.array(z.string()).optional().describe("Updated tags for the ticket")
        },
        handler: async ({ id, subject, comment, priority, status, assignee_id, group_id, type, tags }) => {
          try {
            const ticketData = {};
            
            if (subject !== undefined) ticketData.subject = subject;
            if (comment !== undefined) ticketData.comment = { body: comment };
            if (priority !== undefined) ticketData.priority = priority;
            if (status !== undefined) ticketData.status = status;
            if (assignee_id !== undefined) ticketData.assignee_id = assignee_id;
            if (group_id !== undefined) ticketData.group_id = group_id;
            if (type !== undefined) ticketData.type = type;
            if (tags !== undefined) ticketData.tags = tags;
            
            const result = await zendeskClient.updateTicket(id, ticketData);
            return {
              content: [{ 
                type: "text", 
                text: `Ticket updated successfully!\n\n${JSON.stringify(result, null, 2)}`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error updating ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      },
      {
        name: "delete_ticket",
        description: "Delete a ticket",
        schema: {
          id: z.number().describe("Ticket ID to delete")
        },
        handler: async ({ id }) => {
          try {
            await zendeskClient.deleteTicket(id);
            return {
              content: [{ 
                type: "text", 
                text: `Ticket ${id} deleted successfully!`
              }]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error deleting ticket: ${error.message}` }],
              isError: true
            };
          }
        }
      }
    ];
