<template>
  <Page :title="$t('llmSettings.title')" :description="$t('llmSettings.description')">
    <template #header>
      <Button :loading="isSaving" :disabled="!unlocked || !hasChanges" @click="save">
        <Save class="h-4 w-4 mr-2" />
        {{ $t("llmSettings.save") }}
      </Button>
    </template>

    <!-- Warning gate -->
    <Card class="border-amber-500/50">
      <CardHeader>
        <CardTitle class="flex items-center gap-2 text-amber-600 dark:text-amber-500">
          <AlertTriangle class="h-5 w-5" />
          {{ $t("llmSettings.warning.title") }}
        </CardTitle>
        <CardDescription>{{ $t("llmSettings.warning.description") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button v-if="!unlocked" variant="outline" @click="unlocked = true">
          <Unlock class="h-4 w-4 mr-2" />
          {{ $t("llmSettings.warning.unlock") }}
        </Button>
        <div v-else class="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck class="h-4 w-4 text-amber-600 dark:text-amber-500" />
          {{ $t("llmSettings.warning.unlocked") }}
        </div>
      </CardContent>
    </Card>

    <!-- Config — visible but locked (dimmed + non-interactive) until acknowledged -->
    <div
      :class="[
        'space-y-6 transition-opacity',
        { 'pointer-events-none select-none opacity-50': !unlocked },
      ]"
      :aria-disabled="!unlocked"
    >
      <!-- Chat provider -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("llmSettings.chat.title") }}</CardTitle>
          <CardDescription>{{ $t("llmSettings.chat.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
          <Input
            v-model="providerChoice"
            type="select"
            :label="$t('llmSettings.chat.provider')"
            :options="providerOptions"
            :helper-text="$t('llmSettings.chat.providerHelper')"
          />

          <Input
            v-if="showBaseUrl"
            v-model="form.baseUrl"
            :label="$t('llmSettings.chat.baseUrl')"
            placeholder="https://api.example.com/v1"
            :helper-text="$t('llmSettings.chat.baseUrlHelper')"
          />

          <Input
            v-model="form.byo"
            type="switch"
            :label="$t('llmSettings.chat.byo')"
            :hint="$t('llmSettings.chat.byoHint')"
          />

          <Input
            v-if="form.byo"
            v-model="form.apiKey"
            type="password"
            :label="$t('llmSettings.chat.apiKey')"
            :placeholder="hasApiKey ? '••••••••••••••••' : $t('llmSettings.chat.apiKeyPlaceholder')"
            :helper-text="
              hasApiKey ? $t('llmSettings.chat.apiKeySet') : $t('llmSettings.chat.apiKeyHelper')
            "
          />
        </CardContent>
      </Card>

      <!-- Model tiers -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("llmSettings.tiers.title") }}</CardTitle>
          <CardDescription>{{ $t("llmSettings.tiers.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4 md:grid-cols-3">
          <ModelSelect
            v-model="form.tiers.hard"
            :options="chatModelOptions"
            :label="$t('llmSettings.tiers.hard')"
            :helper-text="$t('llmSettings.tiers.hardHelper')"
            :custom-label="$t('llmSettings.modelCustom')"
            :custom-placeholder="$t('llmSettings.modelCustomPlaceholder')"
          />
          <ModelSelect
            v-model="form.tiers.medium"
            :options="chatModelOptions"
            :label="$t('llmSettings.tiers.medium')"
            :helper-text="$t('llmSettings.tiers.mediumHelper')"
            :custom-label="$t('llmSettings.modelCustom')"
            :custom-placeholder="$t('llmSettings.modelCustomPlaceholder')"
          />
          <ModelSelect
            v-model="form.tiers.easy"
            :options="chatModelOptions"
            :label="$t('llmSettings.tiers.easy')"
            :helper-text="$t('llmSettings.tiers.easyHelper')"
            :custom-label="$t('llmSettings.modelCustom')"
            :custom-placeholder="$t('llmSettings.modelCustomPlaceholder')"
          />
        </CardContent>
      </Card>

      <!-- Embeddings (managed) -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("llmSettings.embedding.title") }}</CardTitle>
          <CardDescription>{{ $t("llmSettings.embedding.description") }}</CardDescription>
        </CardHeader>
        <CardContent>
          <ModelSelect
            v-model="form.embeddingModel"
            :options="EMBEDDING_MODELS"
            :label="$t('llmSettings.embedding.model')"
            :helper-text="$t('llmSettings.embedding.modelHelper')"
            :custom-label="$t('llmSettings.modelCustom')"
            :custom-placeholder="$t('llmSettings.modelCustomPlaceholder')"
          />
        </CardContent>
      </Card>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { Save, AlertTriangle, Unlock, ShieldCheck } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

// A single, flat provider choice in the UI; mapped to the backend's {provider, vendor}.
type ProviderChoice = "openai" | "anthropic" | "gemini" | "mistral" | "grok" | "custom";
type Provider = "openai-compatible" | "anthropic" | "gemini";
type Vendor = "openai" | "mistral" | "grok" | "custom";

interface LlmForm {
  selection: ProviderChoice;
  baseUrl: string;
  byo: boolean;
  apiKey: string;
  tiers: { hard: string; medium: string; easy: string };
  embeddingModel: string;
}

const { t } = useI18n();
const toast = useToast();

const isSaving = ref(false);
const hasApiKey = ref(false);
// Config is gated behind an explicit acknowledgement that changing AI defaults can
// radically alter agent behavior.
const unlocked = ref(false);

// Preset chat models offered per provider (a "Custom…" entry is always appended).
const CHAT_MODELS: Record<ProviderChoice, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  mistral: ["mistral-large-latest", "mistral-small-latest", "ministral-3b-latest"],
  grok: ["grok-4", "grok-4-fast-non-reasoning"],
  custom: [],
};

// Managed embeddings are always OpenAI (1536-dim).
const EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"];

// Sensible default tier→model map per provider, applied when the provider changes.
const DEFAULT_TIERS: Record<ProviderChoice, { hard: string; medium: string; easy: string }> = {
  openai: { hard: "gpt-4o", medium: "gpt-4o-mini", easy: "gpt-4.1-nano" },
  anthropic: { hard: "claude-opus-4-8", medium: "claude-sonnet-4-6", easy: "claude-haiku-4-5" },
  gemini: { hard: "gemini-2.5-pro", medium: "gemini-2.5-flash", easy: "gemini-2.5-flash-lite" },
  mistral: {
    hard: "mistral-large-latest",
    medium: "mistral-small-latest",
    easy: "ministral-3b-latest",
  },
  grok: { hard: "grok-4", medium: "grok-4", easy: "grok-4-fast-non-reasoning" },
  custom: { hard: "", medium: "", easy: "" },
};

function defaults(): LlmForm {
  return {
    selection: "openai",
    baseUrl: "",
    byo: false,
    apiKey: "",
    tiers: { ...DEFAULT_TIERS.openai },
    embeddingModel: "text-embedding-3-small",
  };
}

const form = ref<LlmForm>(defaults());
const original = ref<LlmForm>(defaults());

const providerOptions = computed(() => [
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic (Claude)", value: "anthropic" },
  { label: "Google Gemini", value: "gemini" },
  { label: "Mistral", value: "mistral" },
  { label: "xAI Grok", value: "grok" },
  { label: t("llmSettings.chat.providerCustom"), value: "custom" },
]);

// Bound to the select. The setter resets tier models to the new provider's defaults;
// load() assigns form.selection directly, so loaded tiers are never clobbered.
const providerChoice = computed<ProviderChoice>({
  get: () => form.value.selection,
  set: (v) => {
    form.value.selection = v;
    form.value.tiers = { ...DEFAULT_TIERS[v] };
  },
});

// Custom and OpenAI-compatible non-OpenAI vendors expose a base URL.
const showBaseUrl = computed(() => ["mistral", "grok", "custom"].includes(form.value.selection));

const chatModelOptions = computed(() => CHAT_MODELS[form.value.selection]);

function toProviderVendor(sel: ProviderChoice): { provider: Provider; vendor?: Vendor } {
  switch (sel) {
    case "anthropic":
      return { provider: "anthropic" };
    case "gemini":
      return { provider: "gemini" };
    default:
      return { provider: "openai-compatible", vendor: sel };
  }
}

function toSelection(provider: string, vendor?: string): ProviderChoice {
  if (provider === "anthropic") return "anthropic";
  if (provider === "gemini") return "gemini";
  return (vendor as ProviderChoice) ?? "openai";
}

const hasChanges = computed(() => JSON.stringify(form.value) !== JSON.stringify(original.value));

async function load() {
  try {
    const config = await Hay.organizations.getLlmConfig.query();
    if (config) {
      const f: LlmForm = {
        selection: toSelection(config.chat.provider, config.chat.vendor),
        baseUrl: config.chat.baseUrl ?? "",
        byo: config.chat.hasApiKey,
        apiKey: "",
        tiers: { ...config.chat.tiers },
        embeddingModel: config.embedding.model,
      };
      form.value = f;
      hasApiKey.value = config.chat.hasApiKey;
    }
    original.value = JSON.parse(JSON.stringify(form.value));
  } catch (error) {
    console.error("Failed to load LLM config:", error);
    toast.error(t("llmSettings.loadFailed"));
  }
}

async function save() {
  try {
    isSaving.value = true;
    const { provider, vendor } = toProviderVendor(form.value.selection);
    await Hay.organizations.updateLlmConfig.mutate({
      chat: {
        provider,
        vendor,
        baseUrl: form.value.baseUrl || undefined,
        apiKey: form.value.byo && form.value.apiKey ? form.value.apiKey : undefined,
        clearApiKey: !form.value.byo,
        tiers: form.value.tiers,
      },
      embedding: { model: form.value.embeddingModel },
    });
    hasApiKey.value = form.value.byo && (!!form.value.apiKey || hasApiKey.value);
    form.value.apiKey = "";
    original.value = JSON.parse(JSON.stringify(form.value));
    toast.success(t("llmSettings.saveSuccess"));
  } catch (error) {
    console.error("Failed to save LLM config:", error);
    toast.error(t("llmSettings.saveFailed"));
  } finally {
    isSaving.value = false;
  }
}

onMounted(load);

definePageMeta({ layout: "default" });
useHead({ title: computed(() => `${t("llmSettings.title")} - Hay Dashboard`) });
</script>
