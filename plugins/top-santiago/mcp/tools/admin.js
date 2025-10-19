import { z } from 'zod';
import { topSantiagoClient } from '../api-client.js';

/**
 * Top Santiago Admin Tools
 *
 * These tools are for internal Top Santiago use only
 * Includes: Auth, User, and Agency management
 */

export const adminTools = [
  // ==================== AUTH ====================
  {
    name: "create_api_token",
    description: "Create new API agency token (Restricted - Top Santiago internal use only)",
    schema: {
      token: z.string().min(32).max(64).describe("API token (32-64 characters)"),
      agencyId: z.number().describe("Agency ID"),
      environment: z.enum(["sandbox", "production"]).describe("Environment (sandbox or production)"),
      expiredAt: z.string().optional().describe("Token expiration date (ISO format)")
    },
    handler: async ({ token, agencyId, environment, expiredAt }) => {
      try {
        const data = {
          token,
          agencyId,
          environment,
          expiredAt
        };

        const result = await topSantiagoClient.createAPIToken(data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "API token created successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error creating API token: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },

  // ==================== USER ====================
  {
    name: "create_user",
    description: "Create new User (Restricted - Top Santiago internal use only)",
    schema: {
      email: z.string().email().describe("User email address"),
      userId: z.number().describe("User ID"),
      agencyId: z.number().describe("Agency ID")
    },
    handler: async ({ email, userId, agencyId }) => {
      try {
        const data = {
          email,
          userId,
          agencyId
        };

        const result = await topSantiagoClient.createUser(data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "User and profile created successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error creating user: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },

  // ==================== AGENCY ====================
  {
    name: "create_agency",
    description: "Create a new agency (Restricted - Top Santiago internal use only)",
    schema: {
      name: z.string().describe("Name of the agency"),
      email: z.string().email().describe("Agency email address"),
      contact: z.string().optional().describe("Contact information"),
      id: z.string().optional().describe("Unique identifier for the agency")
    },
    handler: async ({ name, email, contact, id }) => {
      try {
        const data = {
          name,
          email
        };
        if (contact) data.contact = contact;
        if (id) data.id = id;

        const result = await topSantiagoClient.createAgency(data);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Agency created successfully",
              data: result
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error creating agency: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  }
];
