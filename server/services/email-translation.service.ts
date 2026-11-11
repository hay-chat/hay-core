import * as fs from "fs/promises";
import * as path from "path";
import { createLogger } from "@server/lib/logger";
import { DEFAULT_LANGUAGE } from "@server/types/language.types";

const logger = createLogger("email-translation");

/**
 * The email locale for a language: an exact match, else one with the same base
 * language ("pt", "pt-PT" → "pt-BR"), else English.
 */
export function resolveEmailLocale(
  locale: string | null | undefined,
  available: readonly string[],
): string {
  if (locale && available.includes(locale)) return locale;
  const base = locale?.split("-")[0].toLowerCase();
  return (
    available.find((candidate) => candidate.split("-")[0].toLowerCase() === base) ??
    DEFAULT_LANGUAGE
  );
}

/**
 * Parsed contents of a locale JSON file: top-level sections ("common" and one
 * per template id) each map a translation key to its string value.
 */
type LocaleTranslations = Record<string, Record<string, string>>;

export class EmailTranslationService {
  private cache: Map<string, LocaleTranslations> = new Map();
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

  private resolveLocale(locale: string): string {
    return resolveEmailLocale(locale, [...this.cache.keys()]);
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
