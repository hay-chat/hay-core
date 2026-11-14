<template>
  <div class="space-y-4">
    <Input
      id="hc-name"
      :model-value="modelValue.name"
      :label="$t('helpCenter.basics.name')"
      :placeholder="$t('helpCenter.basics.namePlaceholder')"
      :hint="$t('helpCenter.basics.nameHint')"
      maxlength="120"
      @update:model-value="update({ name: String($event) })"
    />

    <div class="space-y-1.5">
      <Label for="hc-subdomain">{{ $t("helpCenter.basics.address") }}</Label>
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <Input
            id="hc-subdomain"
            :model-value="modelValue.subdomain"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="63"
            aria-describedby="hc-subdomain-status"
            @update:model-value="update({ subdomain: String($event).trim().toLowerCase() })"
          />
        </div>
        <span class="shrink-0 text-sm text-neutral-muted">.{{ baseDomain }}</span>
      </div>
      <p
        id="hc-subdomain-status"
        role="status"
        class="text-sm"
        :class="statusClass"
        data-testid="subdomain-status"
      >
        {{ statusMessage }}
      </p>
    </div>

    <LanguageSelect
      :model-value="modelValue.language"
      :label="$t('helpCenter.basics.language')"
      :helper-text="$t('helpCenter.basics.languageHint')"
      @update:model-value="update({ language: $event ?? modelValue.language })"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { Hay } from "@/utils/api";
import type { HelpCenterBasics, SubdomainProblem } from "@/utils/help-center";

const props = defineProps<{
  modelValue: HelpCenterBasics;
  baseDomain: string;
  /** The address this help center already has: always usable, so it is not checked. */
  currentSubdomain?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: HelpCenterBasics];
  /** Whether the address has been confirmed as usable. */
  "update:addressOk": [value: boolean];
}>();

type AddressStatus = "checking" | "available" | "current" | "failed" | SubdomainProblem;

const USABLE: AddressStatus[] = ["available", "current", "failed"];

const { t } = useI18n();
const status = ref<AddressStatus>("checking");
/** Only the answer to the latest check counts. */
let latestCheck = 0;

function update(patch: Partial<HelpCenterBasics>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}

const check = useDebounceFn(async (subdomain: string, id: number) => {
  try {
    const result = await Hay.helpCenter.checkSubdomain.query({ subdomain });
    if (id !== latestCheck) return;
    status.value = result.available ? "available" : result.reason;
  } catch (error) {
    if (id !== latestCheck) return;
    console.error("Failed to check the help center address:", error);
    status.value = "failed";
  }
}, 400);

watch(
  () => props.modelValue.subdomain,
  (subdomain) => {
    const id = ++latestCheck;
    if (props.currentSubdomain && subdomain === props.currentSubdomain) {
      status.value = "current";
    } else if (!subdomain) {
      status.value = "too_short";
    } else {
      status.value = "checking";
      void check(subdomain, id);
    }
  },
  { immediate: true },
);

// A failed check does not block: the server checks the address again on save.
watch(status, (value) => emit("update:addressOk", USABLE.includes(value)), { immediate: true });

const fullAddress = computed(() => `${props.modelValue.subdomain}.${props.baseDomain}`);

const statusMessage = computed(() => {
  switch (status.value) {
    case "current":
      return t("helpCenter.basics.addressCurrent", { address: fullAddress.value });
    case "available":
      return t("helpCenter.basics.addressAvailable", { address: fullAddress.value });
    case "checking":
      return t("helpCenter.basics.addressChecking");
    case "failed":
      return t("helpCenter.basics.addressCheckFailed");
    case "too_short":
      return t("helpCenter.basics.addressTooShort");
    case "too_long":
      return t("helpCenter.basics.addressTooLong");
    case "invalid_characters":
      return t("helpCenter.basics.addressInvalid");
    case "reserved":
      return t("helpCenter.basics.addressReserved");
    case "taken":
      return t("helpCenter.basics.addressTaken");
    default:
      return "";
  }
});

const statusClass = computed(() => {
  if (status.value === "available") return "text-green-700";
  if (status.value === "checking" || status.value === "current") return "text-neutral-muted";
  return "text-destructive";
});
</script>
