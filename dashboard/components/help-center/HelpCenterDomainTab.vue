<template>
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center gap-2">
        <CardTitle>{{ $t("helpCenter.domain.title") }}</CardTitle>
        <template v-if="domain">
          <Badge :variant="domain.verified ? 'success' : 'warning'" data-testid="domain-status">
            {{
              domain.verified ? $t("helpCenter.domain.connected") : $t("helpCenter.domain.pending")
            }}
          </Badge>
        </template>
      </div>
      <CardDescription>
        {{ $t("helpCenter.domain.description", { address: helpCenter.defaultUrl }) }}
      </CardDescription>
    </CardHeader>

    <!-- No custom domain -->
    <CardContent v-if="!domain" class="space-y-3">
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="addDomain">
        <div class="min-w-0 flex-1 basis-64">
          <Input
            id="hc-custom-domain"
            v-model="newDomain"
            :label="$t('helpCenter.domain.inputLabel')"
            placeholder="help.yourcompany.com"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            maxlength="253"
          />
        </div>
        <Button type="submit" :loading="working === 'add'" :disabled="!newDomain.trim()">
          {{ $t("helpCenter.domain.add") }}
        </Button>
      </form>
      <p v-if="addError" class="text-sm text-destructive" role="alert">{{ addError }}</p>
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.domain.addHint") }}</p>
    </CardContent>

    <!-- Verified -->
    <CardContent v-else-if="domain.verified" class="space-y-3">
      <a
        :href="helpCenter.url"
        target="_blank"
        rel="noopener noreferrer"
        class="break-all text-sm font-medium text-primary hover:underline"
      >
        {{ domain.domain }}
      </a>
      <p v-if="domain.verifiedAt" class="text-sm text-neutral-muted">
        {{ $t("helpCenter.domain.verifiedAt", { date: formatDateTime(domain.verifiedAt) }) }}
      </p>
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.domain.httpsNote") }}</p>
      <Button variant="outline" @click="confirmingRemove = true">
        {{ $t("helpCenter.domain.remove") }}
      </Button>
    </CardContent>

    <!-- Waiting for DNS -->
    <CardContent v-else class="space-y-4">
      <p class="text-sm">
        {{ $t("helpCenter.domain.pendingIntro", { domain: domain.domain }) }}
      </p>
      <div class="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{{ $t("helpCenter.domain.recordType") }}</TableHead>
              <TableHead>{{ $t("helpCenter.domain.recordName") }}</TableHead>
              <TableHead>{{ $t("helpCenter.domain.recordValue") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="record in records"
              :key="record.type"
              :data-testid="`record-${record.type}`"
            >
              <TableCell class="align-top">
                <span class="font-medium">{{ record.type }}</span>
                <span class="block text-xs text-neutral-muted">{{ record.note }}</span>
              </TableCell>
              <TableCell class="align-top">
                <div class="flex items-start gap-2">
                  <code class="break-all text-sm">{{ record.name }}</code>
                  <HelpCenterCopyButton
                    icon-only
                    :value="record.name"
                    :label="$t('helpCenter.domain.copyName', { type: record.type })"
                  />
                </div>
              </TableCell>
              <TableCell class="align-top">
                <div class="flex items-start gap-2">
                  <code class="break-all text-sm">{{ record.value }}</code>
                  <HelpCenterCopyButton
                    icon-only
                    :value="record.value"
                    :label="$t('helpCenter.domain.copyValue', { type: record.type })"
                  />
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.domain.recordsHint") }}</p>

      <p
        v-if="verifyError"
        class="text-sm text-destructive"
        role="alert"
        data-testid="verify-error"
      >
        {{ verifyError }}
      </p>
      <p v-if="domain.checkedAt" class="text-sm text-neutral-muted">
        {{ $t("helpCenter.domain.checkedAt", { date: formatDateTime(domain.checkedAt) }) }}
      </p>
      <p class="text-sm text-neutral-muted">{{ $t("helpCenter.domain.httpsNote") }}</p>

      <div class="flex flex-wrap gap-2">
        <Button :loading="working === 'verify'" data-testid="verify-domain" @click="verify">
          {{ $t("helpCenter.domain.checkNow") }}
        </Button>
        <Button variant="outline" :disabled="working !== null" @click="confirmingRemove = true">
          {{ $t("helpCenter.domain.remove") }}
        </Button>
      </div>
    </CardContent>

    <ConfirmDialog
      v-model:open="confirmingRemove"
      :title="$t('helpCenter.domain.removeTitle', { domain: domain?.domain ?? '' })"
      :description="$t('helpCenter.domain.removeDescription', { address: helpCenter.defaultUrl })"
      :confirm-text="$t('helpCenter.domain.remove')"
      :destructive="true"
      :loading="working === 'remove'"
      @confirm="removeDomain"
    />
  </Card>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Hay } from "@/utils/api";
import { errorMessage, type HelpCenterView } from "@/utils/help-center";
import HelpCenterCopyButton from "./HelpCenterCopyButton.vue";

const props = defineProps<{ helpCenter: HelpCenterView }>();
const emit = defineEmits<{
  updated: [helpCenter: HelpCenterView];
  /** The server's state changed without returning it (a failed check records its time). */
  refresh: [];
}>();

const { t } = useI18n();
const toast = useToast();
const { formatDateTime } = useOrgDateTime();

const domain = computed(() => props.helpCenter.customDomain);
const working = ref<"add" | "verify" | "remove" | null>(null);

// CNAME first: it also routes the traffic. TXT only proves control, for DNS
// providers that hide the CNAME behind a proxy.
const records = computed(() => {
  const set = domain.value?.records;
  if (!set) return [];
  return [
    { type: "CNAME", note: t("helpCenter.domain.recommended"), ...set.cname },
    { type: "TXT", note: t("helpCenter.domain.alternative"), ...set.txt },
  ];
});

const newDomain = ref("");
const addError = ref("");

async function addDomain() {
  working.value = "add";
  addError.value = "";
  try {
    emit(
      "updated",
      await Hay.helpCenter.setCustomDomain.mutate({ domain: newDomain.value.trim() }),
    );
    newDomain.value = "";
  } catch (error) {
    console.error("Failed to add the custom domain:", error);
    addError.value = errorMessage(error) ?? t("helpCenter.domain.addFailed");
  } finally {
    working.value = null;
  }
}

const verifyError = ref("");

async function verify() {
  working.value = "verify";
  verifyError.value = "";
  try {
    const updated = await Hay.helpCenter.verifyCustomDomain.mutate();
    emit("updated", updated);
    if (updated.customDomain?.verified) toast.success(t("helpCenter.domain.verified"));
  } catch (error) {
    // Expected while DNS has not caught up: the server says what it looked for.
    verifyError.value = errorMessage(error) ?? t("helpCenter.domain.verifyFailed");
    emit("refresh");
  } finally {
    working.value = null;
  }
}

const confirmingRemove = ref(false);

async function removeDomain() {
  working.value = "remove";
  try {
    emit("updated", await Hay.helpCenter.removeCustomDomain.mutate());
    verifyError.value = "";
    confirmingRemove.value = false;
    toast.success(t("helpCenter.domain.removed"));
  } catch (error) {
    console.error("Failed to remove the custom domain:", error);
    toast.error(t("helpCenter.saveFailed"), errorMessage(error));
  } finally {
    working.value = null;
  }
}
</script>
