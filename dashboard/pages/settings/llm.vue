<template>
  <Page :title="$t('llmSettings.title')" :description="$t('llmSettings.description')">
    <template #header>
      <Button v-if="unlocked" :loading="isSaving" :disabled="!hasChanges" @click="save">
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

    <template v-if="unlocked">
      <!-- Chat provider -->
      <Card>
        <CardHeader>
          <CardTitle>{{ $t("llmSettings.chat.title") }}</CardTitle>
          <CardDescription>{{ $t("llmSettings.chat.description") }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-6">
          <Input
            v-model="form.provider"
            type="select"
            :label="$t('llmSettings.chat.provider')"
            :options="providerOptions"
            :helper-text="$t('llmSettings.chat.providerHelper')"
          />

          <Input
            v-if="form.provider === 'openai-compatible'"
            v-model="form.vendor"
            type="select"
            :label="$t('llmSettings.chat.vendor')"
            :options="vendorOptions"
            :helper-text="$t('llmSettings.chat.vendorHelper')"
          />

          <Input
            v-if="form.provider === 'openai-compatible' && form.vendor !== 'openai'"
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
          <Input
            v-model="form.tiers.hard"
            :label="$t('llmSettings.tiers.hard')"
            :helper-text="$t('llmSettings.tiers.hardHelper')"
          />
          <Input
            v-model="form.tiers.medium"
            :label="$t('llmSettings.tiers.medium')"
            :helper-text="$t('llmSettings.tiers.mediumHelper')"
          />
          <Input
            v-model="form.tiers.easy"
            :label="$t('llmSettings.tiers.easy')"
            :helper-text="$t('llmSettings.tiers.easyHelper')"
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
          <Input
            v-model="form.embeddingModel"
            :label="$t('llmSettings.embedding.model')"
            :helper-text="$t('llmSettings.embedding.modelHelper')"
          />
        </CardContent>
      </Card>
    </template>
  </Page>
</template>

<script setup lang="ts">
import { Save, AlertTriangle, Unlock, ShieldCheck } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

type Provider = "openai-compatible" | "anthropic" | "gemini";
type Vendor = "openai" | "mistral" | "grok" | "custom";

interface LlmForm {
  provider: Provider;
  vendor: Vendor;
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

function defaults(): LlmForm {
  return {
    provider: "openai-compatible",
    vendor: "openai",
    baseUrl: "",
    byo: false,
    apiKey: "",
    tiers: { hard: "gpt-4o", medium: "gpt-4o-mini", easy: "gpt-4.1-nano" },
    embeddingModel: "text-embedding-3-small",
  };
}

const form = ref<LlmForm>(defaults());
const original = ref<LlmForm>(defaults());

const providerOptions = computed(() => [
  { label: "OpenAI-compatible (OpenAI / Mistral / Grok / custom)", value: "openai-compatible" },
  { label: "Anthropic (Claude)", value: "anthropic" },
  { label: "Google Gemini", value: "gemini" },
]);

const vendorOptions = computed(() => [
  { label: "OpenAI", value: "openai" },
  { label: "Mistral", value: "mistral" },
  { label: "xAI Grok", value: "grok" },
  { label: t("llmSettings.chat.vendorCustom"), value: "custom" },
]);

const hasChanges = computed(() => JSON.stringify(form.value) !== JSON.stringify(original.value));

async function load() {
  try {
    const config = await Hay.organizations.getLlmConfig.query();
    if (config) {
      const f: LlmForm = {
        provider: config.chat.provider as Provider,
        vendor: (config.chat.vendor as Vendor) ?? "openai",
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
    await Hay.organizations.updateLlmConfig.mutate({
      chat: {
        provider: form.value.provider,
        vendor: form.value.provider === "openai-compatible" ? form.value.vendor : undefined,
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
