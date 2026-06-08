/**
 * Slash Command Extension - Notion-style
 * Provides a menu for inserting different block types and mentions
 */

import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import SlashCommandList from "./SlashCommandList.vue";
import type { MCPTool, DocumentItem } from "./MentionExtension";
import { createSuggestionRenderer } from "./suggestionRenderer";

export interface CommandItem {
  title: string;
  description: string;
  icon: string;
  type?: "block" | "action" | "document";
  pluginId?: string;
  id?: string;
  command: ({ editor, range }: { editor: Editor; range: Range }) => void;
}

export interface SlashCommandConfig {
  mcpTools: MCPTool[];
  documents: DocumentItem[];
}

export const configureSlashCommand = (config: SlashCommandConfig) => {
  return Extension.create({
    name: "slashCommand",

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          command: ({ editor, range, props }) => {
            props.command({ editor, range });
          },
          items: ({ query }): CommandItem[] => {
            const lowerQuery = query.toLowerCase();

            const allCommands: CommandItem[] = [
              {
                title: "Text",
                description: "Just start typing with plain text",
                icon: "type",
                type: "block",
                command: ({ editor, range }) => {
                  editor.chain().focus().deleteRange(range).setParagraph().run();
                },
              },
              {
                title: "Heading 1",
                description: "Big section heading",
                icon: "heading-1",
                type: "block",
                command: ({ editor, range }) => {
                  editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
                },
              },
              {
                title: "Heading 2",
                description: "Medium section heading",
                icon: "heading-2",
                type: "block",
                command: ({ editor, range }) => {
                  editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
                },
              },
              {
                title: "Bullet List",
                description: "Create a simple bullet list",
                icon: "list",
                type: "block",
                command: ({ editor, range }) => {
                  editor.chain().focus().deleteRange(range).toggleBulletList().run();
                },
              },
              {
                title: "Numbered List",
                description: "Create a list with numbering",
                icon: "list-ordered",
                type: "block",
                command: ({ editor, range }) => {
                  editor.chain().focus().deleteRange(range).toggleOrderedList().run();
                },
              },
              {
                title: "Action",
                description: `Insert an action (${config.mcpTools.length} available)`,
                icon: "zap",
                type: "action",
                command: () => {
                  // This will be handled by the component to show submenu
                },
              },
              {
                title: "Document",
                description: `Insert a document (${config.documents.length} available)`,
                icon: "book",
                type: "document",
                command: () => {
                  // This will be handled by the component to show submenu
                },
              },
            ];

            if (!query) {
              return allCommands;
            }

            return allCommands.filter(
              (item) =>
                item.title.toLowerCase().includes(lowerQuery) ||
                item.description.toLowerCase().includes(lowerQuery),
            );
          },
          render: createSuggestionRenderer({
            component: SlashCommandList,
            mapProps: (props) => ({
              ...props,
              mcpTools: config.mcpTools,
              documents: config.documents,
            }),
          }),
        }),
      ];
    },
  });
};
