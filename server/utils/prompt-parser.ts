import * as fs from "fs/promises";
import * as path from "path";
import type { PromptContent, PromptMetadata } from "../types/prompt.types";

export class PromptParser {
  /**
   * Parse a markdown file with frontmatter
   */
  static async parsePromptFile(filePath: string): Promise<PromptContent> {
    const content = await fs.readFile(filePath, "utf-8");
    return this.parsePromptContent(content, path.basename(filePath, ".md"));
  }

  /**
   * Parse prompt content with frontmatter
   */
  static parsePromptContent(content: string, defaultId: string): PromptContent {
    const lines = content.split("\n");
    let metadata: Partial<PromptMetadata> = {};
    let bodyStartIndex = 0;

    // Check for frontmatter
    if (lines[0] === "---") {
      const endIndex = lines.indexOf("---", 1);
      if (endIndex > 0) {
        // Parse YAML frontmatter
        metadata = this.parseYamlFrontmatter(lines.slice(1, endIndex));
        bodyStartIndex = endIndex + 1;
      }
    }

    // Get the content after frontmatter
    const promptContent = lines.slice(bodyStartIndex).join("\n").trim();

    // Extract variables from content
    const variables = this.extractVariables(promptContent);

    // Ensure all metadata fields have values
    const fullMetadata: PromptMetadata = {
      id: metadata.id || defaultId,
      name: metadata.name || this.idToName(defaultId),
      description: metadata.description || "",
      version: metadata.version || "1.0.0",
    };

    return {
      metadata: fullMetadata,
      content: promptContent,
      variables,
    };
  }

  /**
   * Parse YAML frontmatter (simple parser for our needs)
   */
  private static parseYamlFrontmatter(lines: string[]): Partial<PromptMetadata> {
    const metadata: Partial<PromptMetadata> = {};

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, "");
        
        switch (key) {
          case "id":
            metadata.id = cleanValue;
            break;
          case "name":
            metadata.name = cleanValue;
            break;
          case "description":
            metadata.description = cleanValue;
            break;
          case "version":
            metadata.version = cleanValue;
            break;
        }
      }
    }

    return metadata;
  }

  /**
   * Extract variable names from prompt content
   */
  private static extractVariables(content: string): string[] {
    const variables = new Set<string>();
    
    // Match simple variables: {{variable}}
    const simpleVarPattern = /\{\{([^}#/]+?)\}\}/g;
    let match;
    
    while ((match = simpleVarPattern.exec(content)) !== null) {
      const varName = match[1].trim();
      // Skip if it's a helper or special syntax
      if (!varName.startsWith("#") && !varName.startsWith("/")) {
        // Handle dot notation (object.property)
        const baseName = varName.split(".")[0];
        // Handle pipe notation (variable|default:"value")
        const cleanName = baseName.split("|")[0].trim();
        variables.add(cleanName);
      }
    }

    // Match conditionals: {{#if variable}}
    const conditionalPattern = /\{\{#if\s+([^}]+?)\}\}/g;
    while ((match = conditionalPattern.exec(content)) !== null) {
      const varName = match[1].trim().split(".")[0];
      variables.add(varName);
    }

    // Match loops: {{#each array}}
    const loopPattern = /\{\{#each\s+([^}]+?)\}\}/g;
    while ((match = loopPattern.exec(content)) !== null) {
      const varName = match[1].trim().split(".")[0];
      variables.add(varName);
    }

    return Array.from(variables);
  }

  /**
   * Convert ID to human-readable name
   */
  private static idToName(id: string): string {
    return id
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  /**
   * Check if file exists
   */
  static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}