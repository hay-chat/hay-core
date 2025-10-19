import { z } from 'zod';
import { topSantiagoClient } from '../api-client.js';

/**
 * Top Santiago Address Tools
 *
 * These tools allow interaction with the Top Santiago Address API
 */

export const addressTools = [
  {
    name: "list_addresses",
    description: "Fetch addresses with optional filters (lodging, street, postal code, locality, council)",
    schema: {
      search: z.string().optional().describe("Filter by lodging | street | postal code | locality | council"),
      description: z.string().optional().describe("Filter by lodging name"),
      streetName: z.string().optional().describe("Filter by street name"),
      locality: z.string().optional().describe("Filter by locality name"),
      council: z.string().optional().describe("Filter by council name"),
      offset: z.number().optional().describe("Number of records to skip (default: 0)"),
      limit: z.number().min(1).max(100).optional().describe("Number of results per page (1-100, default: 10)")
    },
    handler: async ({ search, description, streetName, locality, council, offset, limit }) => {
      try {
        const result = await topSantiagoClient.listAddresses({
          search,
          description,
          streetName,
          locality,
          council,
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
            text: `Error listing addresses: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "get_address",
    description: "Retrieve a specific address by ID",
    schema: {
      id: z.string().describe("ID of the address to retrieve")
    },
    handler: async ({ id }) => {
      try {
        const result = await topSantiagoClient.getAddress(id);

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
            text: `Error getting address: ${error.response?.data?.message || error.message}`
          }],
          isError: true
        };
      }
    }
  }
];
