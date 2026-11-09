<template>
  <Card>
    <CardHeader>
      <CardTitle>{{ $t("profile.mfa.orgTitle") }}</CardTitle>
      <CardDescription>{{ $t("profile.mfa.orgDescription") }}</CardDescription>
    </CardHeader>
    <CardContent>
      <Input
        :model-value="required"
        type="switch"
        :label="$t('profile.mfa.orgSwitch')"
        :hint="$t('profile.mfa.orgHint')"
        :disabled="saving || loading"
        @update:model-value="save(Boolean($event))"
      />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

const { t } = useI18n();
const toast = useToast();

const required = ref(false);
const saving = ref(false);
const loading = ref(true);

const save = async (next: boolean) => {
  saving.value = true;
  try {
    const result = await Hay.organizations.setMfaRequired.mutate({ required: next });
    required.value = result.mfaRequired;
    toast.success(t("general.saveSuccess"));
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : t("general.saveFailed"));
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  try {
    const settings = await Hay.organizations.getSettings.query();
    required.value = settings.mfaRequired;
  } finally {
    loading.value = false;
  }
});
</script>
