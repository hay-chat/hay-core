import { defineComponent, h, type Component } from "vue";
import { vi } from "vitest";
import type { VueWrapper } from "@vue/test-utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import type {
  HelpCenterCollection,
  HelpCenterState,
  HelpCenterView,
} from "../../utils/help-center";

/** Every `Hay` call the help center UI makes. `vi.hoisted` cannot import, so tests build it there. */
export function createApi() {
  const fn = () => vi.fn();
  return {
    get: fn(),
    checkSubdomain: fn(),
    create: fn(),
    update: fn(),
    setPublished: fn(),
    getPreviewLink: fn(),
    listCollections: fn(),
    createCollection: fn(),
    updateCollection: fn(),
    deleteCollection: fn(),
    reorderCollections: fn(),
    setCollectionArticles: fn(),
    setCustomDomain: fn(),
    verifyCustomDomain: fn(),
    removeCustomDomain: fn(),
    listDocuments: fn(),
  };
}

export function hayMock(api: ReturnType<typeof createApi>) {
  const Hay = {
    helpCenter: {
      get: { query: api.get },
      checkSubdomain: { query: api.checkSubdomain },
      create: { mutate: api.create },
      update: { mutate: api.update },
      setPublished: { mutate: api.setPublished },
      getPreviewLink: { query: api.getPreviewLink },
      listCollections: { query: api.listCollections },
      createCollection: { mutate: api.createCollection },
      updateCollection: { mutate: api.updateCollection },
      deleteCollection: { mutate: api.deleteCollection },
      reorderCollections: { mutate: api.reorderCollections },
      setCollectionArticles: { mutate: api.setCollectionArticles },
      setCustomDomain: { mutate: api.setCustomDomain },
      verifyCustomDomain: { mutate: api.verifyCustomDomain },
      removeCustomDomain: { mutate: api.removeCustomDomain },
    },
    documents: { list: { query: api.listDocuments } },
  };
  return { Hay, HayApi: Hay };
}

export const BASE_DOMAIN = "help.example.com";

export function helpCenter(overrides: Partial<HelpCenterView> = {}): HelpCenterView {
  return {
    id: "hc-1",
    name: "Acme Help",
    subdomain: "acme",
    defaultLanguage: "en",
    isPublished: false,
    searchIndexing: true,
    theme: {
      accentColor: "#2747d6",
      font: "sans",
      layout: "cards",
      heroTitle: null,
      heroSubtitle: null,
      showPoweredBy: true,
    },
    defaultUrl: `https://acme.${BASE_DOMAIN}`,
    url: `https://acme.${BASE_DOMAIN}`,
    customDomain: null,
    ...overrides,
  };
}

export function hubState(view: HelpCenterView | null): HelpCenterState {
  return {
    enabled: true,
    baseDomain: BASE_DOMAIN,
    suggestedSubdomain: view ? "" : "acme",
    helpCenter: view,
  };
}

export function article(documentId: string, live = true): HelpCenterCollection["articles"][number] {
  return {
    documentId,
    title: `Doc ${documentId}`,
    status: live ? "published" : "draft",
    visibility: "public",
    live,
    helpfulCount: 0,
    unhelpfulCount: 0,
  };
}

export function collection(
  id: string,
  articles: HelpCenterCollection["articles"] = [],
): HelpCenterCollection {
  return { id, title: `Collection ${id}`, description: null, icon: null, articles };
}

/** Renders while open, with its texts and a confirm button. */
const ConfirmDialog = defineComponent({
  name: "ConfirmDialog",
  props: {
    open: Boolean,
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    confirmText: { type: String, default: "" },
  },
  emits: ["confirm", "cancel", "update:open"],
  setup(props, { emit }) {
    return () =>
      props.open
        ? h("div", { "data-stub": "ConfirmDialog" }, [
            h("p", props.title),
            h("p", props.description),
            h("button", { "data-testid": "confirm", onClick: () => emit("confirm") }, [
              props.confirmText,
            ]),
          ])
        : null;
  },
});

const passThrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h("div", attrs, slots.default?.());
  },
});

export const stubs: Record<string, Component> = {
  ConfirmDialog,
  Alert: passThrough,
  AlertTitle: passThrough,
  AlertDescription: passThrough,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
};

export const buttonWith = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll("button").find((button) => button.text().includes(text));

export const buttonLabelled = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("button").find((button) => button.attributes("aria-label") === label);
