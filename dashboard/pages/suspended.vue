<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-lg">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div class="p-3 bg-destructive/10 rounded-full">
            <Lock class="h-6 w-6 text-destructive" />
          </div>
          <div>
            <CardTitle>{{ $t(`suspended.title.${reasonKey}`) }}</CardTitle>
            <CardDescription>{{ $t(`suspended.description.${reasonKey}`) }}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-6">
        <p class="text-sm text-muted-foreground">
          {{ userStore.isAdmin ? $t("suspended.ownerHint") : $t("suspended.memberHint") }}
        </p>

        <div class="flex flex-wrap gap-2">
          <Button v-if="userStore.isAdmin && ctaUrl" :loading="opening" @click="openCta">
            {{ ctaLabel }}
          </Button>
          <Button variant="outline" :loading="checking" @click="checkAgain">
            {{ $t("suspended.checkAgain") }}
          </Button>
          <Button variant="ghost" @click="logout">{{ $t("suspended.logout") }}</Button>
        </div>

        <!-- A locked or cancelled workspace can still take its data out until the purge (D15-7). -->
        <WorkspaceExportCard v-if="userStore.isAdmin" />

        <div v-if="otherOrganizations.length" class="space-y-2">
          <h4 class="text-sm font-medium">{{ $t("suspended.switchOrg") }}</h4>
          <div class="flex flex-col gap-1">
            <Button
              v-for="org in otherOrganizations"
              :key="org.id"
              variant="outline"
              class="justify-start"
              :loading="switchingTo === org.id"
              @click="switchTo(org.id)"
            >
              {{ org.name }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Lock } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useUserStore, type User } from "@/stores/user";
import { useAuthStore } from "@/stores/auth";
import { Hay, HayAuthApi } from "@/utils/api";
import { useExternalLink } from "@/composables/useExternalLink";

definePageMeta({
  layout: "empty",
});

const { t } = useI18n();
const userStore = useUserStore();
const authStore = useAuthStore();
const { open } = useExternalLink();

const organization = computed(() => userStore.activeOrganization);
const reasonKey = computed(() => organization.value?.suspensionReason ?? "manual");

const otherOrganizations = computed(() =>
  userStore.organizations.filter((org) => org.id !== userStore.activeOrganizationId),
);

// Billing link: operator notice CTA, then the suspension redirect, then the
// first external menu item (e.g. a hosted plan's "Billing" entry).
const externalMenuUrl = ref<string | null>(null);
const ctaUrl = computed(
  () =>
    organization.value?.accessNotice?.ctaUrl ??
    organization.value?.suspensionRedirectUrl ??
    externalMenuUrl.value,
);
const ctaLabel = computed(
  () => organization.value?.accessNotice?.ctaLabel ?? t("suspended.openBilling"),
);

const opening = ref(false);
const openCta = async () => {
  if (!ctaUrl.value) return;
  opening.value = true;
  try {
    await open(ctaUrl.value);
  } finally {
    opening.value = false;
  }
};

// The store is persisted, so re-check with the server: once the operator lifts
// the suspension the user should get back in without logging out.
const checking = ref(false);
const checkAgain = async () => {
  checking.value = true;
  try {
    const user = await HayAuthApi.auth.me.query();
    userStore.setUser(user as User);
    if (!userStore.isSuspended) {
      window.location.href = "/";
    }
  } catch (error) {
    console.error("Failed to refresh access state:", error);
  } finally {
    checking.value = false;
  }
};

const switchingTo = ref<string | null>(null);
const switchTo = async (organizationId: string) => {
  switchingTo.value = organizationId;
  try {
    await Hay.organizations.switchOrganization.mutate({ organizationId });
    await userStore.switchOrganization(organizationId);
    window.location.href = "/";
  } catch (error) {
    console.error("Failed to switch organization:", error);
    switchingTo.value = null;
  }
};

const logout = () => authStore.logout();

let poll: ReturnType<typeof setInterval> | null = null;
onMounted(async () => {
  await checkAgain();
  poll = setInterval(checkAgain, 30_000);

  try {
    const response = await Hay.plugins.getMenuItems.query();
    externalMenuUrl.value = response.items.find((item) => item.external && item.url)?.url ?? null;
  } catch (error) {
    console.error("Failed to load menu items:", error);
  }
});
onUnmounted(() => {
  if (poll) clearInterval(poll);
});
</script>
