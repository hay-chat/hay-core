import * as fs from "fs/promises";
import * as path from "path";
import mjml2html from "mjml";
import type { EmailTemplate, TemplateRenderOptions } from "../types/email.types";
import { createLogger } from "@server/lib/logger";
import { EmailTranslationService } from "./email-translation.service";

const logger = createLogger("template");

export class TemplateService {
  private templateCache: Map<string, EmailTemplate> = new Map();
  private templateDir: string;
  private baseMjmlPath: string;
  private contentDir: string;
  private translationService: EmailTranslationService;

  constructor() {
    this.templateDir = path.join(__dirname, "../templates/email");
    this.baseMjmlPath = path.join(this.templateDir, "base.mjml");
    this.contentDir = path.join(this.templateDir, "content");
    this.translationService = new EmailTranslationService();
  }

  /**
   * Load all templates on service initialization
   */
  async initialize(): Promise<void> {
    try {
      await this.loadTemplates();
      await this.translationService.initialize();
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize template service");
    }
  }

  /**
   * Auto-discover and load MJML templates from content directory
   */
  private async loadTemplates(): Promise<void> {
    try {
      const contentDirExists = await this.fileExists(this.contentDir);
      if (!contentDirExists) {
        logger.warn("Content directory not found");
        return;
      }

      // Read all .mjml files from content directory
      const files = await fs.readdir(this.contentDir);
      const mjmlFiles = files.filter((file) => file.endsWith(".mjml"));

      logger.info({ count: mjmlFiles.length }, "Loading MJML templates");

      for (const file of mjmlFiles) {
        const templateId = file.replace(".mjml", "");
        const template = await this.loadMjmlTemplate(templateId);
        if (template) {
          this.templateCache.set(templateId, template);
          logger.info({ templateId }, "Loaded template");
        } else {
          logger.warn({ templateId }, "Failed to load template");
        }
      }

      logger.info({ count: this.templateCache.size }, "Total templates cached");
    } catch (error) {
      logger.error({ err: error }, "Error loading templates");
    }
  }

  /**
   * Load MJML template
   */
  private async loadMjmlTemplate(templateId: string): Promise<EmailTemplate | null> {
    try {
      const contentPath = path.join(this.contentDir, `${templateId}.mjml`);
      const contentMjml = await fs.readFile(contentPath, "utf-8");

      // Extract variables from MJML content before compilation
      const variables = this.extractVariables(contentMjml);

      // Store raw MJML content for later rendering with variables
      return {
        id: templateId,
        name: templateId.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        subject: this.extractSubject(contentMjml) || "",
        htmlContent: contentMjml, // Store MJML, will compile during render
        textContent: undefined,
        variables,
        isMjml: true,
      };
    } catch (error) {
      logger.error({ err: error, templateId }, "Error loading MJML template");
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

    // If template is not in cache, try to load it
    if (!template) {
      logger.debug({ templateId }, "Template not in cache, attempting to load");
      const loadedTemplate = await this.loadMjmlTemplate(templateId);
      if (loadedTemplate) {
        this.templateCache.set(templateId, loadedTemplate);
        template = loadedTemplate;
        logger.info({ templateId }, "Successfully loaded template");
      } else {
        logger.error({ templateId }, "Failed to load template");
      }
    }

    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Load base MJML template first
    const baseMjmlExists = await this.fileExists(this.baseMjmlPath);
    if (!baseMjmlExists) {
      throw new Error("Base MJML template not found");
    }

    const baseMjml = await fs.readFile(this.baseMjmlPath, "utf-8");

    // Render MJML template
    const mjmlContent = template.htmlContent;

    // Inject content into base template FIRST (before variable replacement)
    // Handle both {{content}} and {{ content }} (with spaces)
    const fullMjml = baseMjml.replace(/\{\{\s*content\s*\}\}/g, mjmlContent);

    // Two-pass variable substitution for i18n support:
    // Pass 1: Replace translation keys (t.*) with their values (which may contain {{ variable }} placeholders)
    // Do NOT strip unmatched variables — they'll be resolved in Pass 2
    const translations = this.translationService.getTranslations(templateId, options.locale);
    const mjmlWithTranslations = this.replaceVariables(fullMjml, translations, false);

    // Pass 2: Replace regular variables (userName, companyName, etc.)
    // Strip any remaining unmatched variables after this final pass
    const mjmlWithVars = this.replaceVariables(mjmlWithTranslations, variables, true);

    // Compile MJML to HTML
    // NOTE: minify is explicitly disabled due to ReDoS vulnerability in html-minifier (GHSA-pfq8-rq6v-vf5m)
    // We use our own minifyHtml() method instead if needed
    const result = mjml2html(mjmlWithVars, {
      keepComments: false,
      validationLevel: "soft",
      minify: false,
    });

    if (result.errors.length > 0) {
      logger.warn({ errors: result.errors }, "MJML compilation warnings");
    }

    let html = result.html;
    const text = this.htmlToText(html);

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
  private replaceVariables(
    content: string,
    variables: Record<string, unknown>,
    stripUnmatched: boolean = true,
  ): string {
    let result = content;
    const originalLength = content.length;

    // Handle conditional blocks
    result = this.processConditionals(result, variables);
    logger.debug({ originalLength, resultLength: result.length }, "After conditionals");

    // Handle loops
    result = this.processLoops(result, variables);
    logger.debug({ resultLength: result.length }, "After loops");

    // Replace simple variables
    for (const [key, value] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g");
      const matches = result.match(pattern);
      if (matches) {
        logger.debug({ key, count: matches.length }, "Replacing variable instances");
      }
      result = result.replace(pattern, this.formatValue(value));
    }

    // Only strip unmatched variables on the final pass
    if (stripUnmatched) {
      const unmatchedVars = result.match(/\{\{[^}]+\}\}/g);
      if (unmatchedVars) {
        logger.debug(
          { count: unmatchedVars.length, sample: unmatchedVars.slice(0, 5) },
          "Removing unmatched variables",
        );
      }
      result = result.replace(/\{\{[^}]+\}\}/g, "");
    }

    return result;
  }

  /**
   * Process conditional blocks in templates
   */
  private processConditionals(content: string, variables: Record<string, unknown>): string {
    const conditionalPattern = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    let matchCount = 0;

    return content.replace(conditionalPattern, (_match, condition, block) => {
      matchCount++;
      const variable = condition.trim();
      const value = this.getNestedValue(variables, variable);

      logger.debug(
        { conditionNumber: matchCount, variable, result: !!value },
        "Processing conditional",
      );

      if (value) {
        return block; // Don't recursively replace here - will be done in main replaceVariables
      }
      return "";
    });
  }

  /**
   * Process loops in templates
   */
  private processLoops(content: string, variables: Record<string, unknown>): string {
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
  private getNestedValue(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object") {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  /**
   * Format value for display
   */
  private formatValue(value: unknown): string {
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
   * Get translated subject for a template.
   * Falls back to the subject from the MJML comment if no translation is found.
   */
  getTranslatedSubject(templateId: string, locale?: string): string | null {
    return (
      this.translationService.getSubject(templateId, locale) ||
      this.getTemplate(templateId)?.subject ||
      null
    );
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    this.templateCache.clear();
  }

  /**
   * Reload templates and translations
   */
  async reloadTemplates(): Promise<void> {
    this.clearCache();
    await this.loadTemplates();
    await this.translationService.reload();
  }
}
