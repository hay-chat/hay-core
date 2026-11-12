import { computed, inject, provide, ref, type InjectionKey } from "vue";
import type { FormSchema } from "@hay/form-schema";
import { Hay } from "@/utils/api";
import type { RouterInputs, RouterOutputs } from "@/types/trpc";
import { useToast } from "@/composables/useToast";
import { useDomain } from "@/composables/useDomain";
import { normalizeHex, type WebchatThemeMode } from "@/utils/webchat-settings";

type UpdateSettingsInput = RouterInputs["webchat"]["updateSettings"];
type SavedSettings = RouterOutputs["webchat"]["getSettings"];
type UnderAttackState = SavedSettings["underAttack"];

export const DEFAULT_BRAND_COLOR = "#001df5";

/** Everything the Save bar saves. Logo, under-attack mode and the secret act straight away. */
export interface WebchatSettingsForm {
  isEnabled: boolean;
  brandColor: string;
  themeMode: WebchatThemeMode;
  position: "left" | "right";
  widgetTitle: string;
  homeHeading: string;
  showGreeting: boolean;
  greetingMessage: string;
  teaserMessage: string;
  csatEnabled: boolean;
  csatQuestion: string;
  preChatForm: FormSchema | null;
  allowedDomains: string;
  pageToolsEnabled: boolean;
  pageToolsOrigins: string;
  spamClassifierEnabled: boolean;
  spamGuidance: string;
}

const emptyForm = (): WebchatSettingsForm => ({
  isEnabled: true,
  brandColor: DEFAULT_BRAND_COLOR,
  themeMode: "light",
  position: "right",
  widgetTitle: "",
  homeHeading: "",
  showGreeting: true,
  greetingMessage: "",
  teaserMessage: "",
  csatEnabled: true,
  csatQuestion: "",
  preChatForm: null,
  allowedDomains: "",
  pageToolsEnabled: false,
  pageToolsOrigins: "",
  spamClassifierEnabled: false,
  spamGuidance: "",
});

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function toForm(settings: SavedSettings): WebchatSettingsForm {
  return {
    isEnabled: settings.isEnabled,
    brandColor: normalizeHex(settings.brandColor) ?? DEFAULT_BRAND_COLOR,
    themeMode: settings.themeMode,
    position: settings.position,
    widgetTitle: settings.widgetTitle,
    homeHeading: settings.homeHeading ?? "",
    showGreeting: settings.showGreeting,
    greetingMessage: settings.greetingMessage ?? "",
    teaserMessage: settings.teaserMessage ?? "",
    csatEnabled: settings.csatEnabled,
    csatQuestion: settings.csatQuestion ?? "",
    preChatForm: (settings.preChatForm as FormSchema | null) ?? null,
    allowedDomains: settings.allowedDomains.join("\n"),
    pageToolsEnabled: settings.pageTools?.enabled ?? false,
    pageToolsOrigins: settings.pageTools?.allowedOrigins?.join("\n") ?? "",
    spamClassifierEnabled: settings.spamClassifierEnabled,
    spamGuidance: settings.spamGuidance ?? "",
  };
}

function toUpdateInput(form: WebchatSettingsForm): UpdateSettingsInput {
  return {
    isEnabled: form.isEnabled,
    brandColor: normalizeHex(form.brandColor) ?? DEFAULT_BRAND_COLOR,
    themeMode: form.themeMode,
    position: form.position as NonNullable<UpdateSettingsInput["position"]>,
    widgetTitle: form.widgetTitle.trim() || undefined,
    homeHeading: form.homeHeading.trim() || null,
    showGreeting: form.showGreeting,
    greetingMessage: form.greetingMessage || null,
    teaserMessage: form.teaserMessage.trim() || null,
    csatEnabled: form.csatEnabled,
    csatQuestion: form.csatQuestion.trim() || null,
    preChatForm: form.preChatForm,
    allowedDomains: lines(form.allowedDomains),
    pageTools: { enabled: form.pageToolsEnabled, allowedOrigins: lines(form.pageToolsOrigins) },
    spamClassifierEnabled: form.spamClassifierEnabled,
    spamGuidance: form.spamGuidance.trim() || null,
  };
}

/** The state of the Webchat settings page, shared by its tabs and the live preview. */
export function createWebchatSettings() {
  const { t } = useI18n();
  const toast = useToast();

  const form = ref<WebchatSettingsForm>(emptyForm());
  const saved = ref<WebchatSettingsForm>(emptyForm());
  const loading = ref(true);
  const loadFailed = ref(false);
  const saving = ref(false);

  // Read-only facts from the server (contract C2).
  const brandPalette = ref<string[]>([]);
  const brandColorSource = ref<"website" | "custom">("website");
  const logoUrl = ref<string | null>(null);
  const logoSource = ref<"website" | "custom" | null>(null);
  const lastSeenAt = ref<string | null>(null);
  const lastSeenOrigin = ref<string | null>(null);
  const underAttack = ref<UnderAttackState>({ active: false, until: null, source: null });
  const underAttackHours = ref(4);

  // Uploads come back as a path on the API; website icons may be absolute.
  const { getApiUrl } = useDomain();
  const logoSrc = computed(() => {
    const url = logoUrl.value;
    if (!url) return null;
    return /^(https?:|data:)/.test(url) ? url : getApiUrl(url);
  });

  const isDirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value));

  function apply(settings: SavedSettings) {
    saved.value = toForm(settings);
    form.value = clone(saved.value);
    brandPalette.value = (settings.brandPalette ?? []).flatMap(
      (c: string) => normalizeHex(c) ?? [],
    );
    brandColorSource.value = settings.brandColorSource;
    logoUrl.value = settings.logoUrl;
    logoSource.value = settings.logoSource;
    lastSeenAt.value = settings.lastSeenAt;
    lastSeenOrigin.value = settings.lastSeenOrigin;
    underAttack.value = settings.underAttack;
    underAttackHours.value = settings.underAttackHours;
  }

  /** Re-reads the saved settings without throwing away unsaved edits. */
  async function refreshFacts() {
    const settings = await Hay.webchat.getSettings.query();
    const edits = clone(form.value);
    const wasDirty = isDirty.value;
    apply(settings);
    if (wasDirty) form.value = edits;
  }

  async function load() {
    loading.value = true;
    loadFailed.value = false;
    try {
      apply(await Hay.webchat.getSettings.query());
    } catch (error) {
      console.error("Failed to load webchat settings:", error);
      loadFailed.value = true;
      toast.error(t("webchat.loadFailed"));
    } finally {
      loading.value = false;
    }
  }

  async function save() {
    saving.value = true;
    try {
      const sent = clone(form.value);
      await Hay.webchat.updateSettings.mutate(toUpdateInput(sent));
      saved.value = sent;
      // The server sets brandColorSource and normalizes values; keep edits made while saving.
      await refreshFacts();
      toast.success(t("webchat.saveSuccess"));
    } catch (error) {
      console.error("Failed to save webchat settings:", error);
      toast.error(t("webchat.saveFailed"));
    } finally {
      saving.value = false;
    }
  }

  function discard() {
    form.value = clone(saved.value);
  }

  // --- Logo: uploads and removals apply straight away.
  const logoBusy = ref(false);

  async function uploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("webchat.appearance.logoTooLarge"));
      return;
    }
    logoBusy.value = true;
    try {
      const logo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      await Hay.webchat.uploadLogo.mutate({ logo });
      await refreshFacts();
      toast.success(t("webchat.appearance.logoSaved"));
    } catch (error) {
      console.error("Failed to upload the webchat logo:", error);
      toast.error(t("webchat.appearance.logoFailed"));
    } finally {
      logoBusy.value = false;
    }
  }

  async function removeLogo() {
    logoBusy.value = true;
    try {
      await Hay.webchat.removeLogo.mutate();
      await refreshFacts();
      toast.success(t("webchat.appearance.logoRemoved"));
    } catch (error) {
      console.error("Failed to remove the webchat logo:", error);
      toast.error(t("webchat.appearance.logoFailed"));
    } finally {
      logoBusy.value = false;
    }
  }

  // --- Under-attack mode (D9-10): acts straight away, not through Save.
  const togglingUnderAttack = ref(false);

  async function toggleUnderAttack() {
    togglingUnderAttack.value = true;
    try {
      underAttack.value = await Hay.webchat.setUnderAttack.mutate({
        enabled: !underAttack.value.active,
      });
      toast.success(
        t(
          underAttack.value.active
            ? "webchat.security.underAttackOnSuccess"
            : "webchat.security.underAttackOffSuccess",
        ),
      );
    } catch (error) {
      console.error("Failed to change under-attack mode:", error);
      toast.error(t("webchat.saveFailed"));
    } finally {
      togglingUnderAttack.value = false;
    }
  }

  return {
    form,
    saved,
    loading,
    loadFailed,
    saving,
    isDirty,
    brandPalette,
    brandColorSource,
    logoUrl,
    logoSrc,
    logoSource,
    lastSeenAt,
    lastSeenOrigin,
    underAttack,
    underAttackHours,
    logoBusy,
    togglingUnderAttack,
    load,
    save,
    discard,
    uploadLogo,
    removeLogo,
    toggleUnderAttack,
  };
}

export type WebchatSettingsState = ReturnType<typeof createWebchatSettings>;

const WEBCHAT_SETTINGS: InjectionKey<WebchatSettingsState> = Symbol("webchat-settings");

export function provideWebchatSettings(): WebchatSettingsState {
  const state = createWebchatSettings();
  provide(WEBCHAT_SETTINGS, state);
  return state;
}

export function useWebchatSettings(): WebchatSettingsState {
  const state = inject(WEBCHAT_SETTINGS);
  if (!state) throw new Error("useWebchatSettings() needs provideWebchatSettings() above it");
  return state;
}
