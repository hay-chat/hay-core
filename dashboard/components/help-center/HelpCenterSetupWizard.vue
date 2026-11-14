<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <ol class="flex items-center justify-center" :aria-label="$t('helpCenter.setup.steps.label')">
      <li
        v-for="(step, index) in steps"
        :key="step.id"
        class="flex items-center"
        :aria-current="stepper.isCurrent(step.id) ? 'step' : undefined"
      >
        <div class="flex items-center gap-2">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors"
            :class="
              stepper.isCurrent(step.id) || stepper.isAfter(step.id)
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            "
          >
            <Check v-if="stepper.isAfter(step.id)" class="h-4 w-4" />
            <span v-else>{{ index + 1 }}</span>
          </div>
          <span
            class="hidden text-sm sm:inline"
            :class="
              stepper.isCurrent(step.id) ? 'font-medium text-foreground' : 'text-neutral-muted'
            "
          >
            {{ step.label }}
          </span>
        </div>
        <div v-if="index < steps.length - 1" class="mx-2 h-px w-8 bg-border lg:w-12" />
      </li>
    </ol>

    <Card>
      <CardHeader>
        <CardTitle>{{ $t(`helpCenter.setup.${stepper.current.value}.title`) }}</CardTitle>
        <CardDescription>
          {{ $t(`helpCenter.setup.${stepper.current.value}.description`) }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HelpCenterBasicsFields
          v-if="stepper.isCurrent('basics')"
          v-model="basics"
          v-model:address-ok="addressOk"
          :base-domain="baseDomain"
        />

        <HelpCenterThemeFields v-else-if="stepper.isCurrent('brand')" v-model="theme" />

        <div v-else class="space-y-6">
          <HelpCenterCollectionFields v-model="collection" />
          <div class="space-y-2">
            <h3 class="text-sm font-medium">{{ $t("helpCenter.setup.content.documents") }}</h3>
            <HelpCenterDocumentPicker v-model="documentIds" />
            <p v-if="documentIds.length > 0" class="text-sm text-amber-700" role="note">
              {{ $t("helpCenter.articles.publicNotice", { count: documentIds.length }) }}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>

    <div class="flex items-center justify-between gap-2">
      <Button
        v-if="!stepper.isFirst.value"
        variant="outline"
        :disabled="creating"
        @click="stepper.goToPrevious()"
      >
        {{ $t("helpCenter.setup.back") }}
      </Button>
      <div v-else />

      <Button v-if="!stepper.isLast.value" :disabled="!canProceed" @click="stepper.goToNext()">
        {{ $t("helpCenter.setup.continue") }}
      </Button>
      <div v-else class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="creating" @click="finish(false)">
          {{ $t("helpCenter.setup.skipContent") }}
        </Button>
        <Button :loading="creating" :disabled="!collection.title.trim()" @click="finish(true)">
          {{ $t("helpCenter.setup.create") }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStepper } from "@vueuse/core";
import { Check } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { isLanguageCode } from "@/utils/languages";
import {
  DEFAULT_HELP_CENTER_THEME,
  errorMessage,
  normalizeTheme,
  type HelpCenterBasics,
  type HelpCenterCollectionDraft,
  type HelpCenterTheme,
} from "@/utils/help-center";
import HelpCenterBasicsFields from "./HelpCenterBasicsFields.vue";
import HelpCenterThemeFields from "./HelpCenterThemeFields.vue";
import HelpCenterCollectionFields from "./HelpCenterCollectionFields.vue";
import HelpCenterDocumentPicker from "./HelpCenterDocumentPicker.vue";

const props = defineProps<{ baseDomain: string; suggestedSubdomain: string }>();
const emit = defineEmits<{ created: [] }>();

const { t } = useI18n();
const toast = useToast();

const stepper = useStepper(["basics", "brand", "content"]);
const steps = computed(() =>
  stepper.stepNames.value.map((id) => ({ id, label: t(`helpCenter.setup.steps.${id}`) })),
);

const basics = ref<HelpCenterBasics>({
  name: "",
  subdomain: props.suggestedSubdomain,
  language: "en",
});
const addressOk = ref(false);
const theme = ref<HelpCenterTheme>({ ...DEFAULT_HELP_CENTER_THEME });
const collection = ref<HelpCenterCollectionDraft>({ title: "", description: "", icon: "" });
const documentIds = ref<string[]>([]);
const creating = ref(false);

const canProceed = computed(
  () => !stepper.isCurrent("basics") || (basics.value.name.trim() !== "" && addressOk.value),
);

async function finish(withContent: boolean) {
  const language = basics.value.language;
  if (creating.value || !isLanguageCode(language)) return;
  creating.value = true;
  try {
    await Hay.helpCenter.create.mutate({
      name: basics.value.name.trim(),
      subdomain: basics.value.subdomain,
      defaultLanguage: language,
    });
  } catch (error) {
    console.error("Failed to create the help center:", error);
    toast.error(t("helpCenter.setup.createFailed"), errorMessage(error));
    creating.value = false;
    return;
  }

  // The help center exists from here on: a later failure must not send the person
  // back to a form that can no longer be submitted.
  try {
    const chosen = normalizeTheme(theme.value);
    if (JSON.stringify(chosen) !== JSON.stringify(DEFAULT_HELP_CENTER_THEME)) {
      await Hay.helpCenter.update.mutate({ theme: chosen });
    }
    if (withContent) {
      const { id } = await Hay.helpCenter.createCollection.mutate({
        title: collection.value.title.trim(),
        description: collection.value.description.trim() || null,
        icon: collection.value.icon.trim() || null,
      });
      if (documentIds.value.length > 0) {
        await Hay.helpCenter.setCollectionArticles.mutate({
          collectionId: id,
          documentIds: documentIds.value,
        });
      }
    }
    toast.success(t("helpCenter.setup.created"), t("helpCenter.setup.createdNotLive"));
  } catch (error) {
    console.error("Help center created, but setup did not finish:", error);
    toast.warning(t("helpCenter.setup.createdPartly"), errorMessage(error));
  } finally {
    creating.value = false;
    emit("created");
  }
}
</script>
