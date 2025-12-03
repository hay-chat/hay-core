import { z } from 'zod';

/**
 * Judo in Cloud MCP Tools
 *
 * This is a demo/fake plugin that simulates API calls to Judo in Cloud.
 * All tools wait 1 second and return successful responses.
 */

// Helper function to wait for 1 second
const wait = () => new Promise(resolve => setTimeout(resolve, 1000));

export const judoTools = [
  {
    name: "healthcheck",
    description: "Check if the Judo in Cloud plugin is working correctly and return status",
    schema: {},
    handler: async () => {
      try {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "healthy",
              plugin: "judo-in-cloud",
              version: "1.0.0",
              message: "Judo in Cloud plugin is running and ready (demo mode)",
              available_tools: [
                "healthcheck",
                "reset_password",
                "contact",
                "check_email"
              ],
              demo_mode: true,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "unhealthy",
              error: error instanceof Error ? error.message : "Unknown error"
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  },
  {
    name: "reset_password",
    description: "Reset the password for a user",
    schema: {
      email: z.string().describe("Email of the user to reset the password for")
    },
    handler: async ({ email }) => {
      try {
        // Wait 1 second to simulate API call
        await wait();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Password reset email sent successfully",
              email: email,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error resetting password: ${error.message}` }],
          isError: true
        };
      }
    }
  },
  {
    name: "contact",
    description: "Contact the Judo in Cloud team",
    schema: {
      region: z.string().describe("Region of the company to contact"),
      subject: z.string().describe("Needs to be one of the following: 'support', 'sales', 'technical', 'other'"),
      company_name: z.string().optional().describe("Name of the company to contact"),
      email: z.string().describe("Email of the user to include in the contact"),
      phone: z.string().optional().describe("Phone number of the user to include in the contact")
    },
    handler: async ({ region, subject, company_name, email, phone }) => {
      try {
        // Wait 1 second to simulate API call
        await wait();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Contact request submitted successfully",
              data: {
                region,
                subject,
                company_name,
                email,
                phone,
                ticket_id: `JUDO-${Date.now()}`,
                status: "pending"
              },
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error submitting contact request: ${error.message}` }],
          isError: true
        };
      }
    }
  },
  {
    name: "check_email",
    description: "Check if an email is registered in the system",
    schema: {
      email: z.string().describe("Email address to check")
    },
    handler: async ({ email }) => {
      try {
        // Wait 1 second to simulate API call
        await wait();

        // For demo purposes, randomly return registered/not registered
        // You can modify this logic as needed
        const isRegistered = email.includes('@');

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              email: email,
              registered: isRegistered,
              message: isRegistered
                ? "Email is registered in the system"
                : "Email is not registered",
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error checking email: ${error.message}` }],
          isError: true
        };
      }
    }
  }
];
