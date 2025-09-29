import * as fs from "fs/promises";
import * as path from "path";
import type { EmailTemplate, TemplateRenderOptions } from "../types/email.types";

export class TemplateService {
  private templateCache: Map<string, EmailTemplate> = new Map();
  private templateDir: string;
  private baseTemplatePath: string;

  constructor() {
    this.templateDir = path.join(__dirname, "../templates/email");
    this.baseTemplatePath = path.join(this.templateDir, "base.template.html");
  }

  /**
   * Load all templates on service initialization
   */
  async initialize(): Promise<void> {
    try {
      await this.loadTemplates();
    } catch (error) {
      console.error("Failed to initialize template service:", error);
    }
  }

  /**
   * Load templates from the templates directory
   */
  private async loadTemplates(): Promise<void> {
    try {
      const templateConfigPath = path.join(this.templateDir, "templates.json");
      const configExists = await this.fileExists(templateConfigPath);
      
      if (!configExists) {
        console.warn("Templates configuration not found, skipping template loading");
        return;
      }

      const configContent = await fs.readFile(templateConfigPath, "utf-8");
      const templatesConfig = JSON.parse(configContent);

      for (const templateConfig of templatesConfig.templates) {
        const template = await this.loadTemplate(templateConfig.id);
        if (template) {
          this.templateCache.set(templateConfig.id, template);
        }
      }
    } catch (error) {
      console.error("Error loading templates:", error);
    }
  }

  /**
   * Load a single template
   */
  private async loadTemplate(templateId: string): Promise<EmailTemplate | null> {
    try {
      const htmlPath = path.join(this.templateDir, `${templateId}.template.html`);
      const textPath = path.join(this.templateDir, `${templateId}.template.txt`);

      const htmlExists = await this.fileExists(htmlPath);
      if (!htmlExists) {
        console.warn(`Template HTML file not found: ${templateId}`);
        return null;
      }

      const htmlContent = await fs.readFile(htmlPath, "utf-8");
      let textContent: string | undefined;

      const textExists = await this.fileExists(textPath);
      if (textExists) {
        textContent = await fs.readFile(textPath, "utf-8");
      }

      const variables = this.extractVariables(htmlContent);

      return {
        id: templateId,
        name: templateId.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        subject: this.extractSubject(htmlContent) || "",
        htmlContent,
        textContent,
        variables,
      };
    } catch (error) {
      console.error(`Error loading template ${templateId}:`, error);
      return null;
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract subject from template HTML comments
   */
  private extractSubject(content: string): string | null {
    const subjectMatch = content.match(/<!--\s*subject:\s*(.*?)\s*-->/i);
    return subjectMatch ? subjectMatch[1].trim() : null;
  }

  /**
   * Extract variables from template content
   */
  private extractVariables(content: string): string[] {
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variablePattern.exec(content)) !== null) {
      const variable = match[1].trim();
      if (!variable.startsWith("#") && !variable.startsWith("/")) {
        variables.add(variable);
      }
    }

    return Array.from(variables);
  }

  /**
   * Render a template with variables
   */
  async render(options: TemplateRenderOptions): Promise<{ html: string; text?: string }> {
    const { template: templateId, variables = {} } = options;

    let template = this.templateCache.get(templateId);
    
    if (!template && !options.useCache) {
      const loadedTemplate = await this.loadTemplate(templateId);
      if (loadedTemplate) {
        this.templateCache.set(templateId, loadedTemplate);
        template = loadedTemplate;
      }
    }

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let html = this.replaceVariables(template.htmlContent, variables);
    let text = template.textContent
      ? this.replaceVariables(template.textContent, variables)
      : this.htmlToText(html);

    // Apply base template if exists
    const baseExists = await this.fileExists(this.baseTemplatePath);
    if (baseExists && templateId !== "base") {
      const baseContent = await fs.readFile(this.baseTemplatePath, "utf-8");
      html = this.applyBaseTemplate(baseContent, html, variables);
    }

    if (options.stripComments) {
      html = this.stripHtmlComments(html);
    }

    if (options.minify) {
      html = this.minifyHtml(html);
    }

    return { html, text };
  }

  /**
   * Replace variables in template content
   */
  private replaceVariables(content: string, variables: Record<string, any>): string {
    let result = content;

    // Handle conditional blocks
    result = this.processConditionals(result, variables);

    // Handle loops
    result = this.processLoops(result, variables);

    // Replace simple variables
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
      result = result.replace(pattern, this.formatValue(value));
    }

    // Remove any remaining unmatched variables
    result = result.replace(/\{\{[^}]+\}\}/g, "");

    return result;
  }

  /**
   * Process conditional blocks in templates
   */
  private processConditionals(content: string, variables: Record<string, any>): string {
    const conditionalPattern = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    
    return content.replace(conditionalPattern, (_match, condition, block) => {
      const variable = condition.trim();
      const value = this.getNestedValue(variables, variable);
      
      if (value) {
        return this.replaceVariables(block, variables);
      }
      return "";
    });
  }

  /**
   * Process loops in templates
   */
  private processLoops(content: string, variables: Record<string, any>): string {
    const loopPattern = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    
    return content.replace(loopPattern, (_match, arrayPath, block) => {
      const array = this.getNestedValue(variables, arrayPath.trim());
      
      if (Array.isArray(array)) {
        return array
          .map((item, index) => {
            const itemVariables = {
              ...variables,
              item,
              index,
              [`${arrayPath.trim()}_item`]: item,
            };
            return this.replaceVariables(block, itemVariables);
          })
          .join("");
      }
      return "";
    });
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  /**
   * Format value for display
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * Apply base template
   */
  private applyBaseTemplate(baseContent: string, content: string, variables: Record<string, any>): string {
    const baseWithContent = baseContent.replace("{{content}}", content);
    return this.replaceVariables(baseWithContent, variables);
  }

  /**
   * Convert HTML to plain text
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Strip HTML comments
   */
  private stripHtmlComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, "");
  }

  /**
   * Minify HTML
   */
  private minifyHtml(html: string): string {
    return html
      .replace(/\n\s+/g, " ")
      .replace(/\n/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * Get all available templates
   */
  getTemplates(): EmailTemplate[] {
    return Array.from(this.templateCache.values());
  }

  /**
   * Get a specific template
   */
  getTemplate(templateId: string): EmailTemplate | undefined {
    return this.templateCache.get(templateId);
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * Reload templates
   */
  async reloadTemplates(): Promise<void> {
    this.clearCache();
    await this.loadTemplates();
  }
}