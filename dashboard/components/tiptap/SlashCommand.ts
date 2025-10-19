/**
 * Slash Command Extension - Notion-style
 * Provides a menu for inserting different block types and mentions
 */

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { VueRenderer } from "@tiptap/vue-3";
import tippy from "tippy.js";
import type { Instance as TippyInstance } from "tippy.js";
import SlashCommandList from "./SlashCommandList.vue";
import type { MCPTool, DocumentItem } from "./MentionExtension";

export interface CommandItem {
  title: string;
  description: string;
  icon: string;
  type?: "block" | "action" | "document";
  pluginId?: string;
  id?: string;
  command: ({ editor, range }: any) => void;
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
                  editor
                    .chain()
                    .focus()
                    .deleteRange(range)
                    .setNode("heading", { level: 1 })
                    .run();
                },
              },
              {
                title: "Heading 2",
                description: "Medium section heading",
                icon: "heading-2",
                type: "block",
                command: ({ editor, range }) => {
                  editor
                    .chain()
                    .focus()
                    .deleteRange(range)
                    .setNode("heading", { level: 2 })
                    .run();
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
                command: ({ editor, range }) => {
                  // This will be handled by the component to show submenu
                },
              },
              {
                title: "Document",
                description: `Insert a document (${config.documents.length} available)`,
                icon: "book",
                type: "document",
                command: ({ editor, range }) => {
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
        render: () => {
          let component: VueRenderer | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps<CommandItem>) => {
              component = new VueRenderer(SlashCommandList, {
                props: {
                  ...props,
                  mcpTools: config.mcpTools,
                  documents: config.documents,
                },
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy(document.body as any, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element as HTMLElement,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                maxWidth: "none",
                onHide: () => {
                  // Ensure cleanup when popup is hidden
                  if (popup && popup[0]) {
                    popup[0].destroy();
                  }
                  if (component) {
                    component.destroy();
                  }
                  popup = null;
                  component = null;
                },
              });
            },

            onUpdate(props: SuggestionProps<CommandItem>) {
              if (!component || !popup) return;

              component.updateProps({
                ...props,
                mcpTools: config.mcpTools,
                documents: config.documents,
              });

              if (!props.clientRect) {
                return;
              }

              popup[0].setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                // Clean up popup and component
                if (popup && popup[0]) {
                  popup[0].hide();
                }
                // Return false to let Tiptap close the suggestion
                return false;
              }

              if (!component?.ref) return false;

              return component.ref.onKeyDown(props);
            },

            onExit() {
              // Clean up on exit
              if (popup && popup[0]) {
                popup[0].destroy();
              }
              if (component) {
                component.destroy();
              }
              popup = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});};
