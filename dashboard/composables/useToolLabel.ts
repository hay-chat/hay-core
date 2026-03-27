import { useI18n } from "vue-i18n";
import { humanizeToolName } from "@/utils/humanizeToolName";

/**
 * Resolves human-readable labels for MCP tools, plugin names, and config fields.
 *
 * Fallback chain:
 * 1. Plugin translation for current locale (via Vue I18n, loaded by usePluginTranslations)
 * 2. Plugin translation for English (Vue I18n fallbackLocale)
 * 3. Auto-humanize function (send-email → "Send Email")
 */
export function useToolLabel() {
  const { t, te } = useI18n({ useScope: "global" });

  function getToolLabel(pluginId: string, toolName: string): string {
    const key = `plugins.${pluginId}.tools.${toolName}.label`;
    if (te(key)) return t(key);
    return humanizeToolName(toolName);
  }

  function getToolDescription(pluginId: string, toolName: string, fallback?: string): string {
    const key = `plugins.${pluginId}.tools.${toolName}.description`;
    if (te(key)) return t(key);
    return fallback || "";
  }

  function getPluginName(pluginId: string, fallback?: string): string {
    const key = `plugins.${pluginId}.name`;
    if (te(key)) return t(key);
    return fallback || humanizeToolName(pluginId.replace(/^hay-plugin-/, ""));
  }

  function getPluginDescription(pluginId: string, fallback?: string): string {
    const key = `plugins.${pluginId}.description`;
    if (te(key)) return t(key);
    return fallback || "";
  }

  function getConfigLabel(pluginId: string, fieldKey: string, fallback?: string): string {
    const key = `plugins.${pluginId}.config.${fieldKey}.label`;
    if (te(key)) return t(key);
    return fallback || humanizeToolName(fieldKey);
  }

  function getConfigDescription(pluginId: string, fieldKey: string, fallback?: string): string {
    const key = `plugins.${pluginId}.config.${fieldKey}.description`;
    if (te(key)) return t(key);
    return fallback || "";
  }

  return {
    getToolLabel,
    getToolDescription,
    getPluginName,
    getPluginDescription,
    getConfigLabel,
    getConfigDescription,
  };
}
