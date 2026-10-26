import en from "../../i18n/en.json";
import ptBR from "../../i18n/pt-BR.json";

/**
 * Plugin-local translations for the settings UI. The dashboard only loads a
 * plugin's i18n globally after a reload once the plugin is enabled, so the
 * component cannot rely on `$t` and reads the `ui` subtree directly.
 */

interface MessageTree {
  [key: string]: string | MessageTree;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const ENGLISH = en.ui as unknown as MessageTree;
const PORTUGUESE = ptBR.ui as unknown as MessageTree;

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function createTranslator(locale: string | undefined): Translate {
  const messages = locale?.toLowerCase().startsWith("pt") ? PORTUGUESE : ENGLISH;
  return (key, params) => {
    const template = lookup(messages, key) ?? lookup(ENGLISH, key) ?? key;
    if (!params) {
      return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  };
}
