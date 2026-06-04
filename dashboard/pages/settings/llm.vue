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
            :options="embeddingOptions"
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
// Type-only import (erased at runtime); the catalog VALUES are fetched over tRPC,
// because @server has no runtime alias in the dashboard bundle.
import type { ModelFamily } from "@server/services/llm/model-catalog";

type TierMap = { hard: string; medium: string; easy: string };
interface ModelCatalog {
  chatModels: Record<ModelFamily, string[]>;
  embeddingModels: string[];
  defaultTiers: Record<ModelFamily, TierMap>;
}

// A single, flat provider choice in the UI; mapped to the backend's {provider, vendor}.
type ProviderChoice = ModelFamily | "custom";
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

// Catalog fetched from the server on mount (presets + default tier maps).
const catalog = ref<ModelCatalog | null>(null);

const EMPTY_TIERS: TierMap = { hard: "", medium: "", easy: "" };

/** Tier defaults for a UI choice; "custom" has no presets. */
function tierDefaultsFor(choice: ProviderChoice): TierMap {
  if (choice === "custom" || !catalog.value) return { ...EMPTY_TIERS };
  return { ...catalog.value.defaultTiers[choice] };
}

/** Preset chat models for a UI choice ("custom" offers none — free text only). */
function chatModelsFor(choice: ProviderChoice): string[] {
  if (choice === "custom" || !catalog.value) return [];
  return catalog.value.chatModels[choice];
}

function defaults(): LlmForm {
  return {
    selection: "openai",
    baseUrl: "",
    byo: false,
    apiKey: "",
    tiers: tierDefaultsFor("openai"),
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
    form.value.tiers = tierDefaultsFor(v);
  },
});

// Custom and OpenAI-compatible non-OpenAI vendors expose a base URL.
const showBaseUrl = computed(() => ["mistral", "grok", "custom"].includes(form.value.selection));

const chatModelOptions = computed(() => chatModelsFor(form.value.selection));
const embeddingOptions = computed(() => catalog.value?.embeddingModels ?? []);

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

async function loadCatalog() {
  try {
    catalog.value = (await Hay.organizations.getModelCatalog.query()) as ModelCatalog;
  } catch (error) {
    console.error("Failed to load model catalog:", error);
  }
}

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
    } else {
      // No saved config — start from the provider's preset defaults (now that the
      // catalog is loaded, defaults() ran before it was available).
      form.value.tiers = tierDefaultsFor("openai");
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

onMounted(async () => {
  await loadCatalog();
  await load();
});

definePageMeta({ layout: "default" });
useHead({ title: computed(() => `${t("llmSettings.title")} - Hay Dashboard`) });
</script>
