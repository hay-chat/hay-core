/**
 * Custom Mention Extension
 * Handles @ mentions for both Actions and Documents
 */

import Mention from "@tiptap/extension-mention";
import { VueRenderer } from "@tiptap/vue-3";
import tippy from "tippy.js";
import type { Instance as TippyInstance } from "tippy.js";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import MentionList from "./MentionList.vue";

export interface MCPTool {
  id: string;
  name: string;
  label: string;
  pluginId: string;
  pluginName: string;
  description?: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  type: string;
  url?: string;
  title?: string;
}

export interface MentionItem {
  id: string;
  label: string;
  type: "action" | "document";
  meta?: string;
  pluginId?: string;
}

export interface MentionConfig {
  mcpTools: MCPTool[];
  documents: DocumentItem[];
  apiBaseUrl: string;
}

export const configureMentionExtension = (config: MentionConfig) => {
  return Mention.extend({
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-id"),
          renderHTML: (attributes) => {
            if (!attributes.id) {
              return {};
            }
            return {
              "data-id": attributes.id,
            };
          },
        },
        label: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-label"),
          renderHTML: (attributes) => {
            if (!attributes.label) {
              return {};
            }
            return {
              "data-label": attributes.label,
            };
          },
        },
        type: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-type"),
          renderHTML: (attributes) => {
            if (!attributes.type) {
              return {};
            }
            return {
              "data-type": attributes.type,
            };
          },
        },
        pluginId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-plugin-id"),
          renderHTML: (attributes) => {
            if (!attributes.pluginId) {
              return {};
            }
            return {
              "data-plugin-id": attributes.pluginId,
            };
          },
        },
      };
    },
  }).configure({
    HTMLAttributes: {
      class: "mention",
    },
    renderText({ node }) {
      return `@${node.attrs.label}`;
    },
    renderHTML({ node }) {
      const type = node.attrs.type;
      const pluginId = node.attrs.pluginId;
      const classes = ["mention"];

      if (type === "action") {
        classes.push("mention-action");
      } else if (type === "document") {
        classes.push("mention-document");
      }

      // Build the content array
      const content: any[] = [];

      // Add thumbnail for actions with pluginId
      if (type === "action" && pluginId) {
        content.push([
          "img",
          {
            src: `${config.apiBaseUrl}/plugins/thumbnails/${pluginId}`,
            alt: node.attrs.label,
            class: "mention-thumbnail",
          },
        ]);
      } else if (type === "document") {
        // Add book icon for documents
        content.push([
          "span",
          {
            class: "mention-icon mention-icon-document",
          },
        ]);
      }

      // Add the label text (without @ symbol)
      // For documents, wrap in a span with width limit
      if (type === "document") {
        content.push([
          "span",
          {
            class: "mention-document-label",
          },
          node.attrs.label,
        ]);
      } else {
        content.push(node.attrs.label);
      }

      return [
        "span",
        {
          class: classes.join(" "),
          "data-id": node.attrs.id,
          "data-label": node.attrs.label,
          "data-type": node.attrs.type,
          "data-plugin-id": node.attrs.pluginId || null,
        },
        ...content,
      ];
    },
    suggestion: {
      char: "@",
      items: ({ query }): MentionItem[] => {
        const lowerQuery = query.toLowerCase();

        // Convert actions to mention items
        const actions: MentionItem[] = config.mcpTools
          .filter(
            (tool) =>
              tool.name.toLowerCase().includes(lowerQuery) ||
              tool.label.toLowerCase().includes(lowerQuery) ||
              tool.pluginName.toLowerCase().includes(lowerQuery),
          )
          .map((tool) => ({
            id: tool.id,
            label: tool.label,
            type: "action" as const,
            meta: tool.pluginName,
            pluginId: tool.pluginId,
          }));

        // Convert documents to mention items
        const documents: MentionItem[] = config.documents
          .filter(
            (doc) =>
              doc.name.toLowerCase().includes(lowerQuery) ||
              doc.type.toLowerCase().includes(lowerQuery),
          )
          .map((doc) => ({
            id: doc.id,
            label: doc.name,
            type: "document" as const,
            meta: doc.type,
          }));

        return [...actions, ...documents];
      },
      render: () => {
        let component: VueRenderer | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props: SuggestionProps) => {
            component = new VueRenderer(MentionList, {
              props,
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

          onUpdate(props: SuggestionProps) {
            if (!component || !popup) return;

            component.updateProps(props);

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
    } as Omit<SuggestionOptions, "editor">,
  });
};
