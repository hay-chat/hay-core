import * as path from "path";
import * as fs from "fs/promises";
import { PromptParser } from "../utils/prompt-parser";
import { VariableEngine } from "../utils/variable-engine";
import type {
  PromptContent,
  PromptOptions,
  PromptCache,
  PromptConfig,
  PromptVariableType,
} from "../types/prompt.types";
import { SupportedLanguage, DEFAULT_LANGUAGE } from "../types/language.types";
import { Organization } from "../entities/organization.entity";
import { AppDataSource } from "../database/data-source";

export class PromptService {
  private static instance: PromptService;
  private cache: Map<string, PromptCache> = new Map();
  private config: PromptConfig;

  private constructor() {
    this.config = {
      supportedLanguages: Object.values(SupportedLanguage),
      defaultLanguage: DEFAULT_LANGUAGE,
      cacheTTL: process.env.NODE_ENV === "production" ? 3600000 : 0, // 1 hour in prod, no cache in dev
      promptsDirectory: path.join(__dirname, "../prompts"),
    };
  }

  static getInstance(): PromptService {
    if (!PromptService.instance) {
      PromptService.instance = new PromptService();
    }
    return PromptService.instance;
  }

  /**
   * Get a prompt with variable substitution
   */
  async getPrompt(
    promptId: string,
    variables: Record<string, PromptVariableType>,
    options?: Partial<PromptOptions>,
  ): Promise<string> {
    // Determine language
    const language = await this.determineLanguage(options);

    // Load prompt content with fallback
    const promptContent = await this.loadPromptWithFallback(promptId, language);

    // Apply variable substitution
    const renderedContent = VariableEngine.render(promptContent.content, variables);

    return renderedContent;
  }

  /**
   * Get prompt metadata without rendering
   */
  async getPromptMetadata(
    promptId: string,
    language?: SupportedLanguage,
  ): Promise<PromptContent | null> {
    const lang = language || DEFAULT_LANGUAGE;
    return this.loadPromptWithFallback(promptId, lang);
  }

  /**
   * List all available prompts
   */
  async listPrompts(language?: SupportedLanguage): Promise<PromptContent[]> {
    const lang = language || DEFAULT_LANGUAGE;
    const promptsDir = path.join(this.config.promptsDirectory, lang);

    try {
      const prompts: PromptContent[] = [];
      await this.scanDirectory(promptsDir, "", prompts);
      return prompts;
    } catch (error) {
      console.error(`Error listing prompts for language ${lang}:`, error);
      return [];
    }
  }

  /**
   * Validate that all required variables are provided
   */
  validateVariables(
    promptContent: PromptContent,
    providedVariables: Record<string, PromptVariableType>,
  ): { valid: boolean; missing: string[] } {
    const missing = promptContent.variables.filter((varName) => !(varName in providedVariables));

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  /**
   * Clear the prompt cache
   */
  clearCache(promptId?: string, language?: SupportedLanguage): void {
    if (promptId && language) {
      const cacheKey = this.getCacheKey(promptId, language);
      this.cache.delete(cacheKey);
    } else if (promptId) {
      // Clear all languages for this prompt
      for (const key of this.cache.keys()) {
        if (key.endsWith(`:${promptId}`)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear entire cache
      this.cache.clear();
    }
  }

  /**
   * Determine the language to use
   */
  private async determineLanguage(options?: Partial<PromptOptions>): Promise<SupportedLanguage> {
    // Priority: explicit language > organization language > default
    if (options?.language && this.isValidLanguage(options.language)) {
      return options.language as SupportedLanguage;
    }

    if (options?.organizationId) {
      try {
        const organizationRepo = AppDataSource.getRepository(Organization);
        const org = await organizationRepo.findOne({
          where: { id: options.organizationId },
          select: ["defaultLanguage"],
        });

        if (org?.defaultLanguage) {
          return org.defaultLanguage;
        }
      } catch (error) {
        console.error("Error fetching organization language:", error);
      }
    }

    return DEFAULT_LANGUAGE;
  }

  /**
   * Load a prompt with fallback to English
   */
  private async loadPromptWithFallback(
    promptId: string,
    language: SupportedLanguage,
  ): Promise<PromptContent> {
    // Try to load in requested language
    let content = await this.loadPrompt(promptId, language);

    // Fallback to English if not found and language is not English
    if (!content && language !== DEFAULT_LANGUAGE) {
      console.warn(
        `Prompt ${promptId} not found in ${language}, falling back to ${DEFAULT_LANGUAGE}`,
      );
      content = await this.loadPrompt(promptId, DEFAULT_LANGUAGE);
    }

    if (!content) {
      throw new Error(`Prompt not found: ${promptId}`);
    }

    return content;
  }

  /**
   * Load a prompt from cache or filesystem
   */
  private async loadPrompt(
    promptId: string,
    language: SupportedLanguage,
  ): Promise<PromptContent | null> {
    const cacheKey = this.getCacheKey(promptId, language);

    // Check cache
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Load from filesystem
    const filePath = this.getPromptPath(promptId, language);

    try {
      const content = await PromptParser.parsePromptFile(filePath);

      // Cache the result
      this.addToCache(cacheKey, content);

      return content;
    } catch (error) {
      // File doesn't exist or parse error
      return null;
    }
  }

  /**
   * Recursively scan directory for prompt files
   */
  private async scanDirectory(
    dir: string,
    relativePath: string,
    prompts: PromptContent[],
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const newRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          await this.scanDirectory(fullPath, newRelativePath, prompts);
        } else if (entry.name.endsWith(".md")) {
          const promptId = relativePath
            ? `${relativePath}/${entry.name.replace(".md", "")}`
            : entry.name.replace(".md", "");

          try {
            const content = await PromptParser.parsePromptFile(fullPath);
            prompts.push(content);
          } catch (error) {
            console.error(`Error parsing prompt ${fullPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
  }

  /**
   * Get the file path for a prompt
   */
  private getPromptPath(promptId: string, language: SupportedLanguage): string {
    // Ensure .md extension
    const fileName = promptId.endsWith(".md") ? promptId : `${promptId}.md`;
    return path.join(this.config.promptsDirectory, language, fileName);
  }

  /**
   * Get cache key for a prompt
   */
  private getCacheKey(promptId: string, language: SupportedLanguage): string {
    return `${language}:${promptId}`;
  }

  /**
   * Get from cache if valid
   */
  private getFromCache(key: string): PromptContent | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    if (this.config.cacheTTL > 0) {
      const age = Date.now() - cached.timestamp;
      if (age > this.config.cacheTTL) {
        this.cache.delete(key);
        return null;
      }
    }

    return cached.content;
  }

  /**
   * Add to cache
   */
  private addToCache(key: string, content: PromptContent): void {
    this.cache.set(key, {
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a language code is valid
   */
  private isValidLanguage(language: string): boolean {
    return this.config.supportedLanguages.includes(language as SupportedLanguage);
  }
}
