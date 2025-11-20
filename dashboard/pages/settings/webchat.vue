<template>
  <Page
    title="Webchat Settings"
    description="Customize your website chat widget appearance and behavior"
    width="max"
  >
    <!-- Appearance -->
    <Card>
      <CardHeader>
        <CardTitle>Widget Appearance</CardTitle>
        <CardDescription>Customize how the chat widget looks on your website</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid gap-4 md:grid-cols-2">
          <Input
            id="widgetTitle"
            v-model="settingsForm.widgetTitle"
            label="Widget Title"
            placeholder="Chat with us"
          />

          <Input
            id="widgetSubtitle"
            v-model="settingsForm.widgetSubtitle"
            label="Widget Subtitle"
            placeholder="We typically reply within minutes"
          />
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <Label for="position">Position</Label>
            <Select v-model="settingsForm.position">
              <SelectTrigger id="position">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="right">Right</SelectItem>
                <SelectItem value="left">Left</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label for="theme">Theme</Label>
            <Select v-model="settingsForm.theme">
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blue">Blue</SelectItem>
                <SelectItem value="green">Green</SelectItem>
                <SelectItem value="purple">Purple</SelectItem>
                <SelectItem value="black">Black</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Behavior -->
    <Card>
      <CardHeader>
        <CardTitle>Widget Behavior</CardTitle>
        <CardDescription>Configure greeting messages and interaction</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center space-x-2">
          <Switch id="showGreeting" v-model:checked="settingsForm.showGreeting" />
          <Label for="showGreeting">Show greeting message when chat opens</Label>
        </div>

        <Textarea
          v-if="settingsForm.showGreeting"
          id="greetingMessage"
          v-model="settingsForm.greetingMessage"
          label="Greeting Message"
          placeholder="Hello! How can we help you today?"
          :rows="3"
        />
      </CardContent>
    </Card>

    <!-- Security -->
    <Card>
      <CardHeader>
        <CardTitle>Security & Access</CardTitle>
        <CardDescription>Control where your widget can be embedded</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <Textarea
          id="allowedDomains"
          v-model="allowedDomainsText"
          label="Allowed Domains"
          placeholder="example.com&#10;app.example.com&#10;*"
          description="Enter one domain per line. Use * to allow all domains."
          :rows="4"
        />

        <div class="flex items-center space-x-2">
          <Switch id="isEnabled" v-model:checked="settingsForm.isEnabled" />
          <Label for="isEnabled">Enable webchat widget</Label>
        </div>
      </CardContent>
    </Card>

    <!-- Save Button -->
    <div class="flex justify-end gap-2">
      <Button variant="outline" :disabled="!hasChanges || isSaving" @click="resetForm">
        Reset
      </Button>
      <Button :loading="isSaving" :disabled="!hasChanges" @click="saveSettings">
        <Save class="h-4 w-4 mr-2" />
        Save Changes
      </Button>
    </div>

    <!-- Installation -->
    <Card>
      <CardHeader>
        <CardTitle>Installation Code</CardTitle>
        <CardDescription
          >Add this code to your website before the closing &lt;/body&gt; tag</CardDescription
        >
      </CardHeader>
      <CardContent>
        <div class="relative">
          <pre
            class="bg-muted p-4 rounded-lg text-sm overflow-x-auto"
          ><code>{{ installationCode }}</code></pre>
          <Button
            variant="outline"
            size="sm"
            class="absolute top-2 right-2"
            @click="copyInstallationCode"
          >
            <Copy v-if="!copied" class="h-3 w-3 mr-1" />
            <Check v-else class="h-3 w-3 mr-1" />
            {{ copied ? "Copied!" : "Copy" }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Save, Copy, Check } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";
import { useDomain } from "@/composables/useDomain";

const toast = useToast();
const userStore = useUserStore();
const { getApiUrl } = useDomain();
const apiBaseUrl = getApiUrl();

// Form state
const settingsForm = ref({
  widgetTitle: "Chat with us",
  widgetSubtitle: "We typically reply within minutes",
  position: "right" as "left" | "right",
  theme: "blue" as "blue" | "green" | "purple" | "black",
  showGreeting: true,
  greetingMessage: "Hello! How can we help you today?",
  isEnabled: true,
});

const allowedDomainsText = ref("*");
const originalSettings = ref<any>({ ...settingsForm.value, allowedDomains: ["*"] });
const isSaving = ref(false);
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
  const orgId = userStore.activeOrganizationId || "YOUR_ORG_ID";
  return `<${"script"}>
  window.HayChat = window.HayChat || {};
  window.HayChat.config = {
    organizationId: '${orgId}',
    baseUrl: '${apiBaseUrl}',
    widgetTitle: '${settingsForm.value.widgetTitle}',
    widgetSubtitle: '${settingsForm.value.widgetSubtitle}',
    position: '${settingsForm.value.position}',
    theme: '${settingsForm.value.theme}',
    showGreeting: ${settingsForm.value.showGreeting},
    greetingMessage: '${settingsForm.value.greetingMessage}'
  };
</${"script"}>
<${"script"} src="${apiBaseUrl}/webchat/widget.js" async></${"script"}>
<link rel="stylesheet" href="${apiBaseUrl}/webchat/widget.css">`;
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
    };

    allowedDomainsText.value = settings.allowedDomains.join("\n");
    originalSettings.value = { ...settingsForm.value, allowedDomains: settings.allowedDomains };
  } catch (error) {
    console.error("Failed to load webchat settings:", error);
    toast.error("Failed to load webchat settings");
  }
}

// Save settings
async function saveSettings() {
  isSaving.value = true;
  try {
    await Hay.webchat.updateSettings.mutate({
      widgetTitle: settingsForm.value.widgetTitle,
      widgetSubtitle: settingsForm.value.widgetSubtitle || null,
      position: settingsForm.value.position as any,
      theme: settingsForm.value.theme as any,
      showGreeting: settingsForm.value.showGreeting,
      greetingMessage: settingsForm.value.greetingMessage || null,
      allowedDomains: allowedDomainsArray.value,
      isEnabled: settingsForm.value.isEnabled,
    });

    originalSettings.value = { ...settingsForm.value, allowedDomains: allowedDomainsArray.value };

    toast.success("Webchat settings saved successfully");
  } catch (error) {
    console.error("Failed to save webchat settings:", error);
    toast.error("Failed to save webchat settings");
  } finally {
    isSaving.value = false;
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

// Initialize
onMounted(() => {
  loadSettings();
});
</script>
