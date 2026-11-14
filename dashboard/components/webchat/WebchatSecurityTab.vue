<template>
  <section class="space-y-4 pb-6" data-testid="webchat-security">
    <div class="space-y-1">
      <h2 class="text-base">{{ $t("webchat.security.spam") }}</h2>
      <p class="text-sm text-neutral-500">{{ $t("webchat.security.spamHint") }}</p>
    </div>
    <Input
      v-model="form.spamClassifierEnabled"
      type="switch"
      :label="$t('webchat.security.spamClassifier')"
    />
    <p class="-mt-2 text-sm text-neutral-500">{{ $t("webchat.security.spamClassifierHint") }}</p>
    <Input
      id="webchat-spam-guidance"
      v-model="form.spamGuidance"
      type="textarea"
      :label="$t('webchat.security.spamGuidance')"
      :placeholder="$t('webchat.security.spamGuidancePlaceholder')"
      :hint="$t('webchat.security.spamGuidanceHint')"
      :rows="3"
      :maxlength="2000"
    />
  </section>

  <section class="flex flex-wrap items-center gap-3 py-6">
    <div class="min-w-0 flex-1 basis-60 space-y-1">
      <div class="flex items-center gap-2">
        <h2 class="text-base">{{ $t("webchat.security.underAttack") }}</h2>
        <span
          :class="[
            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
            underAttack.active
              ? 'bg-[rgb(254,243,199)] text-[rgb(120,53,15)]'
              : 'bg-neutral-100 text-neutral-500',
          ]"
          data-testid="webchat-under-attack-pill"
        >
          {{ underAttack.active ? $t("webchat.security.on") : $t("webchat.status.off") }}
        </span>
      </div>
      <p class="text-sm text-neutral-500">
        {{ $t("webchat.security.underAttackHint", { hours: state.underAttackHours.value }) }}
      </p>
      <p v-if="underAttack.active && underAttack.until" class="text-sm text-neutral-700">
        {{
          $t(
            underAttack.source === "auto"
              ? "webchat.security.underAttackActiveAuto"
              : "webchat.security.underAttackActiveOwner",
            { until: formatDateTime(underAttack.until) },
          )
        }}
      </p>
    </div>
    <Button
      :variant="underAttack.active ? 'outline' : 'destructive'"
      size="sm"
      :loading="state.togglingUnderAttack.value"
      @click="state.toggleUnderAttack"
    >
      {{ underAttack.active ? $t("webchat.security.turnOff") : $t("webchat.security.turnOn") }}
    </Button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useWebchatSettings } from "@/composables/useWebchatSettings";

const { formatDateTime } = useOrgDateTime();
const state = useWebchatSettings();
const form = state.form;
const underAttack = computed(() => state.underAttack.value);
</script>
