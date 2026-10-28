<template>
  <Page :title="$t('webchat.title')" :description="$t('webchat.description')" width="max">
    <!-- Appearance -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.widgetAppearance") }}</CardTitle>
        <CardDescription>{{ $t("webchat.widgetAppearanceDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <Input
            id="widgetTitle"
            v-model="settingsForm.widgetTitle"
            :label="$t('webchat.widgetTitle')"
            :placeholder="$t('webchat.widgetTitlePlaceholder')"
          />

          <Input
            id="widgetSubtitle"
            v-model="settingsForm.widgetSubtitle"
            :label="$t('webchat.widgetSubtitle')"
            :placeholder="$t('webchat.widgetSubtitlePlaceholder')"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="position">{{ $t("webchat.position") }}</Label>
            <Select v-model="settingsForm.position">
              <SelectTrigger id="position">
                <SelectValue :placeholder="$t('webchat.selectPosition')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="right">{{ $t("webchat.positionRight") }}</SelectItem>
                <SelectItem value="left">{{ $t("webchat.positionLeft") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label for="theme">{{ $t("webchat.theme") }}</Label>
            <Select v-model="settingsForm.theme">
              <SelectTrigger id="theme">
                <SelectValue :placeholder="$t('webchat.selectTheme')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blue">{{ $t("webchat.themeBlue") }}</SelectItem>
                <SelectItem value="green">{{ $t("webchat.themeGreen") }}</SelectItem>
                <SelectItem value="purple">{{ $t("webchat.themePurple") }}</SelectItem>
                <SelectItem value="black">{{ $t("webchat.themeBlack") }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Behavior: the greeting only matters while Web Chat is on -->
    <Card v-if="settingsForm.isEnabled" data-testid="webchat-greeting-card">
      <CardHeader>
        <CardTitle>{{ $t("webchat.widgetBehavior") }}</CardTitle>
        <CardDescription>{{ $t("webchat.widgetBehaviorDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center space-x-2">
          <Switch id="showGreeting" v-model="settingsForm.showGreeting" />
          <Label for="showGreeting">{{ $t("webchat.showGreeting") }}</Label>
        </div>

        <Textarea
          v-if="settingsForm.showGreeting"
          id="greetingMessage"
          v-model="settingsForm.greetingMessage"
          :label="$t('webchat.greetingMessage')"
          :placeholder="$t('webchat.greetingMessagePlaceholder')"
          :rows="3"
        />
      </CardContent>
    </Card>

    <!-- Security -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.securityAccess") }}</CardTitle>
        <CardDescription>{{ $t("webchat.securityAccessDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="allowedDomains">{{ $t("webchat.allowedDomains") }}</Label>
          <Textarea
            id="allowedDomains"
            v-model="allowedDomainsText"
            :placeholder="$t('webchat.allowedDomainsPlaceholder')"
            :rows="4"
          />
          <p class="text-sm text-neutral-muted">{{ $t("webchat.allowedDomainsDescription") }}</p>
        </div>

        <div class="flex items-center space-x-2">
          <Switch id="isEnabled" v-model="settingsForm.isEnabled" />
          <Label for="isEnabled">{{ $t("webchat.enableWebchat") }}</Label>
        </div>
      </CardContent>
    </Card>

    <!-- Spam protection (D9-6 / D9-7) -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.spamProtection") }}</CardTitle>
        <CardDescription>{{ $t("webchat.spamProtectionDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-start space-x-2">
          <Switch id="spamClassifierEnabled" v-model="settingsForm.spamClassifierEnabled" />
          <div class="space-y-1">
            <Label for="spamClassifierEnabled">{{ $t("webchat.spamClassifier") }}</Label>
            <p class="text-sm text-neutral-muted">{{ $t("webchat.spamClassifierDescription") }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="spamGuidance">{{ $t("webchat.spamGuidance") }}</Label>
          <Textarea
            id="spamGuidance"
            v-model="settingsForm.spamGuidance"
            :placeholder="$t('webchat.spamGuidancePlaceholder')"
            :rows="3"
            :maxlength="2000"
          />
          <p class="text-sm text-neutral-muted">{{ $t("webchat.spamGuidanceDescription") }}</p>
        </div>
      </CardContent>
    </Card>

    <!-- Under-attack mode (D9-10): acts immediately, not through Save -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.underAttack") }}</CardTitle>
        <CardDescription>
          {{ $t("webchat.underAttackDescription", { hours: underAttackHours }) }}
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-sm" :class="underAttack.active ? 'font-medium' : 'text-neutral-muted'">
          <template v-if="underAttack.active && underAttack.until">
            {{
              $t(
                underAttack.source === "auto"
                  ? "webchat.underAttackActiveAuto"
                  : "webchat.underAttackActiveOwner",
                { until: formatDateTime(underAttack.until) },
              )
            }}
          </template>
          <template v-else>{{ $t("webchat.underAttackInactive") }}</template>
        </p>
        <Button
          :variant="underAttack.active ? 'outline' : 'destructive'"
          :loading="isTogglingUnderAttack"
          @click="toggleUnderAttack"
        >
          {{
            underAttack.active ? $t("webchat.underAttackTurnOff") : $t("webchat.underAttackTurnOn")
          }}
        </Button>
      </CardContent>
    </Card>

    <!-- Save Button -->
    <div class="flex justify-end gap-2">
      <Button variant="outline" :disabled="!hasChanges || isSaving" @click="resetForm">
        {{ $t("webchat.reset") }}
      </Button>
      <Button :loading="isSaving" :disabled="!hasChanges" @click="saveSettings">
        <Save class="h-4 w-4 mr-2" />
        {{ $t("webchat.saveChanges") }}
      </Button>
    </div>

    <!-- Installation -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.installationCode") }}</CardTitle>
        <CardDescription>{{ $t("webchat.installationCodeDescription") }}</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="relative">
          <pre class="bg-muted p-4 rounded-lg text-sm overflow-x-auto mb-2">{{
            installationCode
          }}</pre>
          <Button variant="outline" size="sm" @click="copyInstallationCode">
            <Copy v-if="!copied" class="h-3 w-3 mr-1" />
            <Check v-else class="h-3 w-3 mr-1" />
            {{ copied ? $t("apiTokens.copied") : $t("apiTokens.copy") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- Customer identity secret (D1): admins only, acts immediately -->
    <Card>
      <CardHeader>
        <CardTitle>{{ $t("webchat.customerIdentity") }}</CardTitle>
        <CardDescription>{{ $t("webchat.customerIdentityDescription") }}</CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        <pre
          v-if="identitySecret"
          class="bg-muted p-4 rounded-lg text-sm overflow-x-auto break-all whitespace-pre-wrap"
          >{{ identitySecret }}</pre
        >
        <p v-else class="text-sm text-neutral-muted">{{ $t("webchat.customerIdentityHidden") }}</p>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="!identitySecret"
            variant="outline"
            size="sm"
            :loading="isRevealingSecret"
            @click="revealIdentitySecret"
          >
            {{ $t("webchat.customerIdentityReveal") }}
          </Button>
          <Button v-else variant="outline" size="sm" @click="copyIdentitySecret">
            <Copy v-if="!secretCopied" class="h-3 w-3 mr-1" />
            <Check v-else class="h-3 w-3 mr-1" />
            {{ secretCopied ? $t("apiTokens.copied") : $t("apiTokens.copy") }}
          </Button>
          <Button variant="outline" size="sm" @click="showRotateDialog = true">
            {{ $t("webchat.customerIdentityRotate") }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <ConfirmDialog
      v-model:open="showRotateDialog"
      :title="$t('webchat.customerIdentityRotateTitle')"
      :description="$t('webchat.customerIdentityRotateDescription')"
      :confirm-text="$t('webchat.customerIdentityRotate')"
      :destructive="true"
      :loading="isRotatingSecret"
      @confirm="rotateIdentitySecret"
    />
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Save, Copy, Check } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterInputs } from "@/types/trpc";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";
import { useDomain } from "@/composables/useDomain";

type UpdateSettingsInput = RouterInputs["webchat"]["updateSettings"];

const { t, locale } = useI18n();
const toast = useToast();
const userStore = useUserStore();
const { getApiUrl } = useDomain();
const apiBaseUrl = getApiUrl();

// Form state
const settingsForm = ref({
  widgetTitle: "Chat with us",
  widgetSubtitle: "",
  position: "right" as NonNullable<UpdateSettingsInput["position"]>,
  theme: "blue" as NonNullable<UpdateSettingsInput["theme"]>,
  showGreeting: true,
  greetingMessage: "Hello! How can we help you today?",
  isEnabled: true,
  spamClassifierEnabled: false,
  spamGuidance: "",
});

const allowedDomainsText = ref("*");
type WebchatSettingsSnapshot = (typeof settingsForm)["value"] & { allowedDomains: string[] };
const originalSettings = ref<WebchatSettingsSnapshot>({
  ...settingsForm.value,
  allowedDomains: ["*"],
});
const isSaving = ref(false);

// Under-attack mode (D9-10). The period length is a server setting (UNDER_ATTACK_HOURS).
const underAttackHours = ref(4);
const underAttack = ref<{ active: boolean; until: string | null; source: "owner" | "auto" | null }>(
  { active: false, until: null, source: null },
);
const isTogglingUnderAttack = ref(false);
const copied = ref(false);

// Computed
const allowedDomainsArray = computed(() => {
  return allowedDomainsText.value
    .split("\n")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
});

const hasChanges = computed(() => {
  return (
    JSON.stringify(settingsForm.value) !== JSON.stringify(originalSettings.value) ||
    allowedDomainsText.value !== originalSettings.value.allowedDomains?.join("\n")
  );
});

const installationCode = computed(() => {
  const organizationId = userStore.activeOrganizationId || "YOUR_ORG_ID";
  // With Web Chat off there is no greeting to show, so the snippet leaves it out.
  const greetingConfig = settingsForm.value.isEnabled
    ? `,
    showGreeting: ${settingsForm.value.showGreeting},
    greetingMessage: '${settingsForm.value.greetingMessage}'`
    : "";
  return `<${"script"}>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: '${organizationId}',
    baseUrl: '${apiBaseUrl}',
    widgetTitle: '${settingsForm.value.widgetTitle}',
    widgetSubtitle: '${settingsForm.value.widgetSubtitle}',
    position: '${settingsForm.value.position}',
    theme: '${settingsForm.value.theme}'${greetingConfig}
  };
</${"script"}>
<${"script"} src="${apiBaseUrl}/v1/webchat/widget.js" async></${"script"}>`;
});

// Load settings
async function loadSettings() {
  try {
    const settings = await Hay.webchat.getSettings.query();

    settingsForm.value = {
      widgetTitle: settings.widgetTitle,
      widgetSubtitle: settings.widgetSubtitle || "",
      position: settings.position,
      theme: settings.theme,
      showGreeting: settings.showGreeting,
      greetingMessage: settings.greetingMessage || "",
      isEnabled: settings.isEnabled,
      spamClassifierEnabled: settings.spamClassifierEnabled,
      spamGuidance: settings.spamGuidance || "",
    };

    underAttack.value = settings.underAttack;
    underAttackHours.value = settings.underAttackHours;
    allowedDomainsText.value = settings.allowedDomains.join("\n");
    originalSettings.value = { ...settingsForm.value, allowedDomains: settings.allowedDomains };
  } catch (error) {
    console.error("Failed to load webchat settings:", error);
    toast.error(t("webchat.loadFailed"));
  }
}

// Save settings
async function saveSettings() {
  isSaving.value = true;
  try {
    await Hay.webchat.updateSettings.mutate({
      widgetTitle: settingsForm.value.widgetTitle,
      widgetSubtitle: settingsForm.value.widgetSubtitle || null,
      position: settingsForm.value.position,
      theme: settingsForm.value.theme,
      showGreeting: settingsForm.value.showGreeting,
      greetingMessage: settingsForm.value.greetingMessage || null,
      allowedDomains: allowedDomainsArray.value,
      isEnabled: settingsForm.value.isEnabled,
      spamClassifierEnabled: settingsForm.value.spamClassifierEnabled,
      spamGuidance: settingsForm.value.spamGuidance.trim() || null,
    });

    originalSettings.value = { ...settingsForm.value, allowedDomains: allowedDomainsArray.value };

    toast.success(t("webchat.saveSuccess"));
  } catch (error) {
    console.error("Failed to save webchat settings:", error);
    toast.error(t("webchat.saveFailed"));
  } finally {
    isSaving.value = false;
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "short" });
}

async function toggleUnderAttack() {
  isTogglingUnderAttack.value = true;
  try {
    underAttack.value = await Hay.webchat.setUnderAttack.mutate({
      enabled: !underAttack.value.active,
    });
    toast.success(
      t(
        underAttack.value.active ? "webchat.underAttackOnSuccess" : "webchat.underAttackOffSuccess",
      ),
    );
  } catch (error) {
    console.error("Failed to change under-attack mode:", error);
    toast.error(t("webchat.saveFailed"));
  } finally {
    isTogglingUnderAttack.value = false;
  }
}

// Reset form
function resetForm() {
  settingsForm.value = { ...originalSettings.value };
  allowedDomainsText.value = originalSettings.value.allowedDomains?.join("\n") || "*";
}

// Copy installation code
async function copyInstallationCode() {
  try {
    await navigator.clipboard.writeText(installationCode.value);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    console.error("Failed to copy:", error);
  }
}

// Customer identity secret (D1)
const identitySecret = ref<string | null>(null);
const isRevealingSecret = ref(false);
const isRotatingSecret = ref(false);
const showRotateDialog = ref(false);
const secretCopied = ref(false);

async function revealIdentitySecret() {
  isRevealingSecret.value = true;
  try {
    identitySecret.value = (await Hay.webchat.revealIdentitySecret.mutate()).secret;
  } catch (error) {
    console.error("Failed to reveal the identity secret:", error);
    toast.error(t("webchat.customerIdentityFailed"));
  } finally {
    isRevealingSecret.value = false;
  }
}

async function rotateIdentitySecret() {
  isRotatingSecret.value = true;
  try {
    identitySecret.value = (await Hay.webchat.rotateIdentitySecret.mutate()).secret;
    showRotateDialog.value = false;
    toast.success(t("webchat.customerIdentityRotated"));
  } catch (error) {
    console.error("Failed to replace the identity secret:", error);
    toast.error(t("webchat.customerIdentityFailed"));
  } finally {
    isRotatingSecret.value = false;
  }
}

async function copyIdentitySecret() {
  if (!identitySecret.value) return;
  try {
    await navigator.clipboard.writeText(identitySecret.value);
    secretCopied.value = true;
    setTimeout(() => {
      secretCopied.value = false;
    }, 2000);
  } catch (error) {
    console.error("Failed to copy:", error);
  }
}

// Initialize
onMounted(() => {
  loadSettings();
});
</script>
