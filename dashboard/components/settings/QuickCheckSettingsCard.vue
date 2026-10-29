<template>
  <Card v-if="form" data-testid="quick-check-settings">
    <CardHeader>
      <CardTitle>{{ $t("businessHours.quickCheck.title") }}</CardTitle>
      <CardDescription>{{ $t("businessHours.quickCheck.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <Input
        v-model="form.enabled"
        type="switch"
        :label="$t('businessHours.quickCheck.enabled')"
        data-testid="quick-check-enabled"
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <Input
          v-model.number="form.updateAfterMinutes"
          type="number"
          :min="1"
          :max="59"
          :label="$t('businessHours.quickCheck.updateAfter')"
          :disabled="!form.enabled"
        />
        <Input
          v-model.number="form.giveUpAfterMinutes"
          type="number"
          :min="2"
          :max="60"
          :label="$t('businessHours.quickCheck.giveUpAfter')"
          :disabled="!form.enabled"
        />
      </div>
      <p class="text-sm text-neutral-muted">
        {{
          $t("businessHours.quickCheck.preview", {
            update: form.updateAfterMinutes,
            giveUp: form.giveUpAfterMinutes,
          })
        }}
      </p>
      <p v-if="!valid" class="text-sm text-destructive">
        {{ $t("businessHours.quickCheck.invalid") }}
      </p>
      <Button
        size="sm"
        class="min-h-11 sm:min-h-0"
        :loading="saving"
        :disabled="!valid"
        data-testid="quick-check-save"
        @click="save"
      >
        {{ $t("common.save") }}
      </Button>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

/**
 * Quick check with the team (D19): instead of handing off, the AI asks the
 * team a fact it doesn't know, tells the customer when it will update them,
 * and keeps answering. Off by default.
 */
interface QuickCheckForm {
  enabled: boolean;
  updateAfterMinutes: number;
  giveUpAfterMinutes: number;
}

const { t } = useI18n();
const toast = useToast();
const form = ref<QuickCheckForm | null>(null);
const saving = ref(false);

const valid = computed(() => {
  const value = form.value;
  if (!value) return false;
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 60;
  return (
    ok(value.updateAfterMinutes) &&
    ok(value.giveUpAfterMinutes) &&
    value.updateAfterMinutes < value.giveUpAfterMinutes
  );
});

onMounted(async () => {
  try {
    form.value = { ...(await Hay.teamQuestions.getSettings.query()) };
  } catch {
    // Members without settings access don't see the card.
    form.value = null;
  }
});

async function save() {
  if (!form.value || !valid.value) return;
  saving.value = true;
  try {
    form.value = { ...(await Hay.teamQuestions.updateSettings.mutate(form.value)) };
    toast.success(t("businessHours.quickCheck.saved"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t("businessHours.quickCheck.invalid"));
  } finally {
    saving.value = false;
  }
}
</script>
