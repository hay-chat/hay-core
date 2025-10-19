import { z } from 'zod';
import { topSantiagoClient } from '../api-client.js';

/**
 * Top Santiago Subscription Tools
 *
 * These tools allow full CRUD operations on subscriptions
 */

// Schema for route object
const routeSchema = z.object({
  routeDate: z.string().describe("Route date in format YYYY-MM-DD"),
  pickupAddressId: z.number().describe("Pickup Address ID"),
  deliveryAddressId: z.number().describe("Delivery Address ID"),
  numberBags: z.number().min(1).optional().describe("Number of bags (minimum 1)"),
  state: z.enum(["HOLD", "PICKUP", "TRANS", "DELIVERED", "PROBLEM", "CANCELED"]).optional().describe("Route state (default: HOLD)"),
  isActive: z.number().optional().describe("Is active flag (1 or 0, default: 1)"),
  notes: z.string().max(200).optional().describe("Additional notes (max 200 characters)")
});

export const subscriptionTools = [
  {
    name: "list_subscriptions",
    description: "Fetch subscriptions with optional filters",
    schema: {
      name: z.string().optional().describe("Filter by subscription name"),
      contact: z.string().optional().describe("Filter by subscription contact"),
      email: z.string().optional().describe("Filter by subscription email"),
      offset: z.number().optional().describe("Number of records to skip (default: 0)"),
      limit: z.number().min(1).max(100).optional().describe("Number of results per page (1-100, default: 10)")
    },
    handler: async ({ name, contact, email, offset, limit }) => {
      try {
        const result = await topSantiagoClient.listSubscriptions({
          name,
          contact,
          email,
          offset,
          limit
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error listing subscriptions: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "get_subscription",
    description: "Retrieve a specific subscription by ID",
    schema: {
      id: z.string().describe("ID of the subscription to retrieve")
    },
    handler: async ({ id }) => {
      try {
        const result = await topSantiagoClient.getSubscription(id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error getting subscription: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "create_subscription",
    description: "Create a new subscription with optional routes",
    schema: {
      name: z.string().describe("Name of the subscription"),
      email: z.string().email().describe("Email address"),
      contact: z.string().describe("Contact information"),
      paymentMode: z.enum(["CRE", "TRF", "CRD", "DIN", "MBWAY", "PAL"]).optional().describe("Payment mode (default: CRE)"),
      notes: z.string().optional().describe("Additional notes"),
      routes: z.array(routeSchema).optional().describe("Array of routes")
    },
    handler: async ({ name, email, contact, paymentMode, notes, routes }) => {
      try {
        const data = {
          name,
          email,
          contact,
          paymentMode,
          notes,
          routes
        };

        const result = await topSantiagoClient.createSubscription(data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Subscription created successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error creating subscription: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "update_subscription",
    description: "Update a subscription by ID (full update - replaces all fields)",
    schema: {
      id: z.string().describe("ID of the subscription to update"),
      name: z.string().describe("Name of the subscription"),
      email: z.string().email().describe("Email address"),
      contact: z.string().describe("Contact information"),
      paymentMode: z.enum(["CRE", "TRF", "CRD", "DIN", "MBWAY", "PAL"]).optional().describe("Payment mode"),
      notes: z.string().optional().describe("Additional notes"),
      routes: z.array(routeSchema).optional().describe("Array of routes")
    },
    handler: async ({ id, name, email, contact, paymentMode, notes, routes }) => {
      try {
        const data = {
          name,
          email,
          contact,
          paymentMode,
          notes,
          routes
        };

        const result = await topSantiagoClient.updateSubscription(id, data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Subscription updated successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error updating subscription: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "patch_subscription",
    description: "Patch a subscription by ID (partial update - only updates provided fields)",
    schema: {
      id: z.string().describe("ID of the subscription to update"),
      name: z.string().optional().describe("Name of the subscription"),
      email: z.string().email().optional().describe("Email address"),
      contact: z.string().optional().describe("Contact information"),
      paymentMode: z.enum(["CRE", "TRF", "CRD", "DIN", "MBWAY", "PAL"]).optional().describe("Payment mode"),
      notes: z.string().optional().describe("Additional notes"),
      routes: z.array(routeSchema).optional().describe("Array of routes")
    },
    handler: async ({ id, name, email, contact, paymentMode, notes, routes }) => {
      try {
        const data = {};
        if (name !== undefined) data.name = name;
        if (email !== undefined) data.email = email;
        if (contact !== undefined) data.contact = contact;
        if (paymentMode !== undefined) data.paymentMode = paymentMode;
        if (notes !== undefined) data.notes = notes;
        if (routes !== undefined) data.routes = routes;

        const result = await topSantiagoClient.patchSubscription(id, data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Subscription patched successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error patching subscription: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "delete_subscription",
    description: "Delete a subscription by ID",
    schema: {
      id: z.string().describe("ID of the subscription to delete")
    },
    handler: async ({ id }) => {
      try {
        await topSantiagoClient.deleteSubscription(id);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Subscription deleted successfully",
              subscriptionId: id
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error deleting subscription: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  }
];
