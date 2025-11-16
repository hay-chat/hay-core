<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Loading State -->
      <div v-if="loading">
        <Loading label="Processing..." />
      </div>

      <!-- Success State -->
      <div v-else-if="success" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl text-green-600">Invitation Declined</CardTitle>
          <CardDescription class="mt-2">
            You have successfully declined the invitation.
          </CardDescription>
        </div>
        <div class="flex justify-center">
          <Button @click="router.push(authStore.isAuthenticated ? '/' : '/login')">
            {{ authStore.isAuthenticated ? "Go to Dashboard" : "Go to Login" }}
          </Button>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl text-red-600">Error</CardTitle>
          <CardDescription class="mt-2">{{ error }}</CardDescription>
        </div>
        <div class="flex justify-center gap-3">
          <Button variant="outline" @click="router.push('/login')"> Go to Login </Button>
          <Button @click="handleDecline"> Try Again </Button>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: false,
  public: true,
});

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
    error.value = "No invitation token provided";
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
      err instanceof Error
        ? err.message
        : "Failed to decline invitation. The link may be invalid or expired.";
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
  title: "Decline Invitation - Hay Dashboard",
  meta: [{ name: "description", content: "Decline organization invitation" }],
});
</script>
