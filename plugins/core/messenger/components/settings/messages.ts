import en from "../../i18n/en.json";
import ptBR from "../../i18n/pt-BR.json";

/**
 * Plugin-local translations for the setup guide. The dashboard only loads a
 * plugin's i18n globally after a reload once the plugin is enabled, so the
 * component reads the `setup` subtree directly (same as the WhatsApp plugin).
 */

interface MessageTree {
  [key: string]: string | MessageTree;
}

const ENGLISH = en.setup as unknown as MessageTree;
const PORTUGUESE = ptBR.setup as unknown as MessageTree;

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function createTranslator(locale: string | undefined): (key: string) => string {
  const messages = locale?.toLowerCase().startsWith("pt") ? PORTUGUESE : ENGLISH;
  return (key) => lookup(messages, key) ?? lookup(ENGLISH, key) ?? key;
}
