import * as fs from "fs/promises";
import * as path from "path";
import { createLogger } from "@server/lib/logger";
import { DEFAULT_LANGUAGE } from "@server/types/language.types";

const logger = createLogger("email-translation");

/**
 * Locale mapping from SupportedLanguage enum values to translation file directories.
 * The enum uses short codes (e.g. "pt") but translation files use regional variants (e.g. "pt-BR").
 */
const LOCALE_MAP: Record<string, string> = {
  pt: "pt-BR",
};

export class EmailTranslationService {
  private cache: Map<string, Record<string, any>> = new Map();
  private localesDir: string;
  private isInitialized = false;

  constructor() {
    this.localesDir = path.join(__dirname, "../i18n/emails");
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.loadLocales();
      this.isInitialized = true;
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize email translation service");
    }
  }

  private async loadLocales(): Promise<void> {
    try {
      const entries = await fs.readdir(this.localesDir, { withFileTypes: true });

      // Load JSON files directly (en.json, pt-BR.json)
      const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));

      for (const file of jsonFiles) {
        const locale = file.name.replace(".json", "");
        const filePath = path.join(this.localesDir, file.name);
        const content = await fs.readFile(filePath, "utf-8");
        this.cache.set(locale, JSON.parse(content));
        logger.info({ locale }, "Loaded email translations");
      }

      logger.info({ count: this.cache.size }, "Total email translation locales loaded");
    } catch (error) {
      logger.error({ err: error }, "Error loading email translation locales");
    }
  }

  /**
   * Resolve the actual locale key used in the cache.
   * Maps short codes (e.g. "pt") to regional variants (e.g. "pt-BR").
   */
  private resolveLocale(locale: string): string {
    // Direct match
    if (this.cache.has(locale)) return locale;
    // Mapped match (e.g. "pt" -> "pt-BR")
    const mapped = LOCALE_MAP[locale];
    if (mapped && this.cache.has(mapped)) return mapped;
    // Fallback to default
    return DEFAULT_LANGUAGE;
  }

  /**
   * Get flattened translation keys for a template + locale.
   * Returns keys prefixed with "t." for use in MJML templates.
   * Merges "common" namespace + template-specific namespace.
   * Falls back to English for missing keys.
   */
  getTranslations(templateId: string, locale?: string): Record<string, string> {
    const resolvedLocale = this.resolveLocale(locale || DEFAULT_LANGUAGE);
    const localeData = this.cache.get(resolvedLocale);
    const fallbackData = this.cache.get(DEFAULT_LANGUAGE);

    if (!localeData && !fallbackData) {
      logger.warn({ locale, templateId }, "No translations found");
      return {};
    }

    const result: Record<string, string> = {};

    // Merge common translations
    const commonKeys = {
      ...(fallbackData?.common || {}),
      ...(localeData?.common || {}),
    };
    for (const [key, value] of Object.entries(commonKeys)) {
      result[`t.common.${key}`] = String(value);
    }

    // Merge template-specific translations
    const templateKeys = {
      ...(fallbackData?.[templateId] || {}),
      ...(localeData?.[templateId] || {}),
    };
    for (const [key, value] of Object.entries(templateKeys)) {
      result[`t.${templateId}.${key}`] = String(value);
    }

    return result;
  }

  /**
   * Get the translated subject line for a template.
   */
  getSubject(templateId: string, locale?: string): string | null {
    const resolvedLocale = this.resolveLocale(locale || DEFAULT_LANGUAGE);
    const localeData = this.cache.get(resolvedLocale);
    const fallbackData = this.cache.get(DEFAULT_LANGUAGE);

    const subject = localeData?.[templateId]?.subject || fallbackData?.[templateId]?.subject;
    return subject || null;
  }

  /**
   * Reload all translation files.
   */
  async reload(): Promise<void> {
    this.cache.clear();
    this.isInitialized = false;
    await this.initialize();
  }
}
