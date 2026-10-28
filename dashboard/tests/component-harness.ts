/**
 * Mount a dashboard component outside Nuxt: auto-imported composables become
 * globals, UI components become light stubs, and `$t` returns the key (with
 * params as JSON) so tests assert on i18n keys rather than copy.
 */
import { defineComponent, h, type Component } from "vue";
import { mount } from "@vue/test-utils";
import { vi } from "vitest";

export const translate = (key: string, params?: unknown) =>
  params !== undefined && typeof params === "object" ? `${key} ${JSON.stringify(params)}` : key;

export const toast = { success: vi.fn(), error: vi.fn() };
export const router = { push: vi.fn() };

export function stubNuxtGlobals() {
  vi.stubGlobal("useI18n", () => ({ t: translate }));
  vi.stubGlobal("useToast", () => toast);
  vi.stubGlobal("useRouter", () => router);
  vi.stubGlobal("useOrgDateTime", () => ({
    formatDate: (value: unknown) => String(value),
    formatDateTime: (value: unknown) => String(value),
  }));
  vi.stubGlobal("definePageMeta", () => {});
  vi.stubGlobal("useHead", () => {});
}

/** A wrapper that renders its default slot (and a #header slot) in a div. */
const container = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
      return () => h("div", { "data-stub": name, ...attrs }, [slots.header?.(), slots.default?.()]);
    },
  });

/** Dialog renders only while open, like the real one. */
const Dialog = defineComponent({
  name: "Dialog",
  props: { open: Boolean },
  setup(props, { slots }) {
    return () => (props.open ? h("div", { "data-stub": "Dialog" }, slots.default?.()) : null);
  },
});

const Button = defineComponent({
  name: "Button",
  props: { loading: Boolean, disabled: Boolean },
  emits: ["click"],
  setup(props, { slots, emit }) {
    return () =>
      h(
        "button",
        { disabled: props.disabled || props.loading, onClick: () => emit("click") },
        slots.default?.(),
      );
  },
});

/** Text, number and select inputs as one <input>/<select> labelled by `label`. */
const Input = defineComponent({
  name: "Input",
  props: {
    modelValue: { type: [String, Number, Boolean], default: "" },
    label: { type: String, default: "" },
    type: { type: String, default: "text" },
    options: { type: Array as () => Array<{ label: string; value: string }>, default: () => [] },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      props.type === "select"
        ? h(
            "select",
            {
              "aria-label": props.label,
              value: props.modelValue,
              onChange: (e: Event) =>
                emit("update:modelValue", (e.target as HTMLSelectElement).value),
            },
            props.options.map((o) => h("option", { value: o.value }, o.label)),
          )
        : h("input", {
            "aria-label": props.label,
            value: props.modelValue,
            onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value),
          });
  },
});

const Switch = defineComponent({
  name: "Switch",
  props: { modelValue: Boolean, id: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("input", {
        type: "checkbox",
        id: props.id,
        checked: props.modelValue,
        onChange: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).checked),
      });
  },
});

const Badge = defineComponent({
  name: "Badge",
  setup(_, { slots }) {
    return () => h("span", { "data-stub": "Badge" }, slots.default?.());
  },
});

const EmptyState = defineComponent({
  name: "EmptyState",
  props: { title: { type: String, default: "" }, description: { type: String, default: "" } },
  setup(props) {
    return () => h("div", { "data-stub": "EmptyState" }, `${props.title} ${props.description}`);
  },
});

export const uiStubs: Record<string, Component> = {
  Page: container("Page"),
  Card: container("Card"),
  CardContent: container("CardContent"),
  CardHeader: container("CardHeader"),
  CardTitle: container("CardTitle"),
  CardDescription: container("CardDescription"),
  DialogContent: container("DialogContent"),
  DialogHeader: container("DialogHeader"),
  DialogTitle: container("DialogTitle"),
  DialogDescription: container("DialogDescription"),
  DialogFooter: container("DialogFooter"),
  Label: container("Label"),
  Loading: container("Loading"),
  Dialog,
  Button,
  Input,
  Switch,
  Badge,
  EmptyState,
};

export function mountWithStubs(
  component: Component,
  options: { props?: Record<string, unknown>; stubs?: Record<string, Component | boolean> } = {},
) {
  return mount(component, {
    props: options.props,
    global: {
      components: uiStubs,
      stubs: options.stubs,
      mocks: { $t: translate },
    },
  });
}
