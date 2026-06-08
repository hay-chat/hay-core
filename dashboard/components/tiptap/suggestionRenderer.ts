/**
 * Shared render() factory for Tiptap suggestion popups (@ mentions and
 * / commands). A tippy popup hosts a Vue list component.
 *
 * Why this exists: the @ and / menus previously each inlined their own
 * render() with teardown spread across THREE paths — tippy's own `onHide`
 * callback (which called `popup.destroy()`), plus `onExit` and `onKeyDown`.
 * Destroying the tippy instance from inside its own `onHide` lifecycle
 * re-enters tippy's teardown while a hide transition is still pending, which
 * intermittently orphaned the popup element in <body>. Result: the menu
 * "sometimes" stayed open after selecting an item or pressing Escape.
 *
 * Here teardown lives in ONE idempotent `destroy()` invoked from `onExit`
 * (the suggestion ended — e.g. an item was selected) and from `onKeyDown`
 * (Escape). There is no `onHide` callback, so there is no re-entrancy.
 *
 * Escape is delegated to the list component first so nested UI (the slash
 * submenu) can consume it to navigate back; only an Escape the list does not
 * handle closes the popup. Once the popup is torn down, Escape returns false
 * so it can bubble to a surrounding dialog.
 */

import { VueRenderer } from "@tiptap/vue-3";
import tippy from "tippy.js";
import type { Instance as TippyInstance } from "tippy.js";
import type { Component } from "vue";
import type { SuggestionProps } from "@tiptap/suggestion";

interface SuggestionRendererOptions {
  /** The Vue component rendered inside the popup (the item list). */
  component: Component;
  /**
   * Maps the raw suggestion props to the props passed to the list component.
   * Defaults to passing the suggestion props through unchanged. The slash
   * command uses this to inject its mcpTools/documents config.
   */
  mapProps?: (props: SuggestionProps) => Record<string, unknown>;
}

export const createSuggestionRenderer = (options: SuggestionRendererOptions) => {
  const { component, mapProps } = options;
  const toProps = (props: SuggestionProps): Record<string, unknown> =>
    mapProps ? mapProps(props) : (props as unknown as Record<string, unknown>);

  return () => {
    let renderer: VueRenderer | null = null;
    let popup: TippyInstance | null = null;

    // Single, idempotent teardown. Safe to call from any exit path and more
    // than once (e.g. Escape then onExit) — the optional chaining no-ops once
    // the refs are cleared.
    const destroy = () => {
      popup?.destroy();
      renderer?.destroy();
      popup = null;
      renderer = null;
    };

    return {
      onStart: (props: SuggestionProps) => {
        renderer = new VueRenderer(component, {
          props: toProps(props),
          editor: props.editor,
        });

        if (!props.clientRect) {
          return;
        }

        popup = tippy(document.body, {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: renderer.element as HTMLElement,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
          maxWidth: "none",
        });
      },

      onUpdate(props: SuggestionProps) {
        if (!renderer || !popup) {
          return;
        }

        renderer.updateProps(toProps(props));

        if (!props.clientRect) {
          return;
        }

        popup.setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        });
      },

      onKeyDown(props: { event: KeyboardEvent }): boolean {
        // Popup already torn down (e.g. a previous Escape) — let the event
        // bubble so a surrounding dialog can handle it.
        if (!renderer) {
          return false;
        }

        // Give the list component first crack so the slash submenu can use
        // Escape/Backspace to go back instead of closing the whole popup.
        const handledByList = renderer.ref?.onKeyDown?.(props) ?? false;
        if (handledByList) {
          return true;
        }

        if (props.event.key === "Escape") {
          destroy();
          return true;
        }

        return false;
      },

      onExit() {
        destroy();
      },
    };
  };
};
