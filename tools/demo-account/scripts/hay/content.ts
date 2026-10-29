/**
 * Loads the knowledge documents (knowledge/<locale>/*.md) and playbooks (playbooks/<platform>/*.md)
 * a Hay.chat org needs for one store, and turns playbook markdown into the editor's Tiptap document.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ROOT } from "../lib/data";
import type { Locale, Platform } from "../lib/types";
import { actionPlaceholders, markdownToTiptap, parseFrontMatter, type TiptapDoc } from "./markdown";
import { pluginIdForTool } from "./tools";

export const PLATFORMS: Platform[] = ["shopify", "woocommerce", "nuvemshop"];

export const LOCALE_BY_PLATFORM: Record<Platform, Locale> = {
  shopify: "en",
  woocommerce: "en",
  nuvemshop: "pt-BR",
};

/** server/entities/document.entity.ts DocumentationType values. */
export const DOCUMENT_TYPES = [
  "article",
  "guide",
  "faq",
  "tutorial",
  "reference",
  "policy",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** server/types/organization-settings.types.ts APPROVAL_CATEGORIES. */
export const APPROVAL_CATEGORIES = [
  "refund",
  "cancel",
  "discount",
  "exchange",
  "return",
  "address_change",
  "customer_update",
  "note",
] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

export interface KnowledgeDoc {
  file: string;
  title: string;
  type: DocumentType;
  /** Stores the document applies to; defaults to every platform of its locale. */
  platforms: Platform[];
  /** Markdown body; documents keep it as markdown (the dashboard renders non-editor docs as markdown). */
  content: string;
}

export interface PlaybookFile {
  file: string;
  title: string;
  trigger: string;
  description: string;
  approvalCategories: ApprovalCategory[];
  markdown: string;
  instructions: TiptapDoc;
  actions: string[];
}

function asString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${file}: front-matter "${field}" is required`);
  return value.trim();
}

function asList(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [String(value)];
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => join(dir, f));
}

export function parseKnowledgeDoc(path: string, locale: Locale): KnowledgeDoc {
  const file = basename(path);
  const { data, body } = parseFrontMatter(readFileSync(path, "utf8"));
  const type = (data.type ?? "article") as DocumentType;
  if (!DOCUMENT_TYPES.includes(type)) throw new Error(`${file}: unknown type "${type}"`);
  const platforms = asList(data.platforms) as Platform[];
  for (const p of platforms)
    if (!PLATFORMS.includes(p)) throw new Error(`${file}: unknown platform "${p}"`);
  return {
    file,
    title: asString(data.title, "title", file),
    type,
    platforms:
      platforms.length > 0 ? platforms : PLATFORMS.filter((p) => LOCALE_BY_PLATFORM[p] === locale),
    content: body,
  };
}

export function loadKnowledge(platform: Platform, root = ROOT): KnowledgeDoc[] {
  const locale = LOCALE_BY_PLATFORM[platform];
  return markdownFiles(join(root, "knowledge", locale))
    .map((path) => parseKnowledgeDoc(path, locale))
    .filter((doc) => doc.platforms.includes(platform));
}

export function parsePlaybook(source: string, file: string): PlaybookFile {
  const { data, body } = parseFrontMatter(source);
  const approvalCategories = asList(data.approvalCategories) as ApprovalCategory[];
  for (const c of approvalCategories) {
    if (!APPROVAL_CATEGORIES.includes(c))
      throw new Error(`${file}: unknown approval category "${c}"`);
  }
  const trigger = asString(data.trigger, "trigger", file);
  if (trigger.length > 255) throw new Error(`${file}: trigger is longer than 255 characters`);
  return {
    file,
    title: asString(data.title, "title", file),
    trigger,
    description: asString(data.description, "description", file),
    approvalCategories,
    markdown: body,
    instructions: markdownToTiptap(body, pluginIdForTool),
    actions: [...new Set(actionPlaceholders(body))],
  };
}

export function loadPlaybooks(platform: Platform, root = ROOT): PlaybookFile[] {
  return markdownFiles(join(root, "playbooks", platform)).map((path) =>
    parsePlaybook(readFileSync(path, "utf8"), basename(path)),
  );
}
