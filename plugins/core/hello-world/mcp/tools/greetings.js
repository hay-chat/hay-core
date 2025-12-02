import { z } from 'zod';

/**
 * Hello World MCP Tools
 *
 * This file demonstrates two types of tools:
 * 1. list_greetings - A "list" tool that returns data (like a GET request)
 * 2. create_greeting - A "post" tool that accepts input (like a POST request)
 */

export const greetingsTools = [
  {
    name: "list_greetings",
    description: "List available greetings in different languages",
    schema: {
      language: z.string().optional().describe("Filter by language (e.g., 'en', 'es', 'fr')")
    },
    handler: async ({ language }) => {
      try {
        // Sample greetings data
        const allGreetings = [
          { id: 1, language: "en", text: "Hello World" },
          { id: 2, language: "es", text: "Hola Mundo" },
          { id: 3, language: "fr", text: "Bonjour le Monde" },
          { id: 4, language: "de", text: "Hallo Welt" },
          { id: 5, language: "ja", text: "こんにちは世界" },
          { id: 6, language: "pt", text: "Olá Mundo" }
        ];

        // Filter by language if provided
        const greetings = language
          ? allGreetings.filter(g => g.language === language)
          : allGreetings;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: greetings.length,
              greetings: greetings
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing greetings: ${error.message}` }],
          isError: true
        };
      }
    }
  },
  {
    name: "create_greeting",
    description: "Create a personalized Hello World greeting",
    schema: {
      name: z.string().describe("Name to include in the greeting"),
      language: z.string().optional().describe("Language for the greeting (default: 'en')")
    },
    handler: async ({ name, language = 'en' }) => {
      try {
        // Map of greetings by language
        const greetingTemplates = {
          en: "Hello World",
          es: "Hola Mundo",
          fr: "Bonjour le Monde",
          de: "Hallo Welt",
          ja: "こんにちは世界",
          pt: "Olá Mundo"
        };

        const baseGreeting = greetingTemplates[language] || greetingTemplates.en;
        const personalizedGreeting = `${baseGreeting}, ${name}!`;

        // This is a demo - in a real plugin, you might save this to a database
        // For now, we just return the greeting
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              greeting: personalizedGreeting,
              message: "Greeting created successfully (demo mode - not persisted)",
              metadata: {
                name: name,
                language: language,
                timestamp: new Date().toISOString()
              }
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error creating greeting: ${error.message}` }],
          isError: true
        };
      }
    }
  }
];
