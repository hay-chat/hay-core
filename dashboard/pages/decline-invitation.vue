<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Loading State -->
      <div v-if="loading">
        <Loading :label="$t('common.processing')" />
      </div>

      <!-- Success State -->
      <div v-else-if="success" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl text-green-600">{{
            $t("declineInvitation.title")
          }}</CardTitle>
          <CardDescription class="mt-2">
            {{ $t("declineInvitation.description") }}
          </CardDescription>
        </div>
        <div class="flex justify-center">
          <Button @click="router.push(authStore.isAuthenticated ? '/' : '/login')">
            {{ authStore.isAuthenticated ? $t("common.goToDashboard") : $t("common.goToLogin") }}
          </Button>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl text-red-600">{{
            $t("declineInvitation.errorTitle")
          }}</CardTitle>
          <CardDescription class="mt-2">{{ error }}</CardDescription>
        </div>
        <div class="flex justify-center gap-3">
          <Button variant="outline" @click="router.push('/login')">
            {{ $t("common.goToLogin") }}
          </Button>
          <Button @click="handleDecline">
            {{ $t("common.tryAgain") }}
          </Button>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Hay } from "@/utils/api";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: false,
  public: true,
});

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const token = computed(() => route.query.token as string);
const loading = ref(true);
const success = ref(false);
const error = ref("");

// Decline invitation
const handleDecline = async () => {
  if (!token.value) {
    error.value = t("declineInvitation.noToken");
    loading.value = false;
    return;
  }

  try {
    loading.value = true;
    error.value = "";
    success.value = false;

    const result = await Hay.invitations.declineInvitation.mutate({
      token: token.value,
    });

    if (result.success) {
      success.value = true;

      // Redirect after a short delay
      setTimeout(() => {
        router.push(authStore.isAuthenticated ? "/" : "/login");
      }, 3000);
    }
  } catch (err) {
    console.error("Failed to decline invitation:", err);
    error.value =
      err instanceof Error ? err.message : t("declineInvitation.declineFailed");
  } finally {
    loading.value = false;
  }
};

// Auto-decline on mount
onMounted(() => {
  handleDecline();
});

// SEO
useHead({
  title: t("declineInvitation.pageTitle"),
  meta: [{ name: "description", content: t("declineInvitation.pageDescription") }],
});
</script>
