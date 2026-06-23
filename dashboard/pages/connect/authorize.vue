<template>
  <CardHeader>
    <div class="flex justify-center mb-4">
      <div
        class="w-16 h-16 rounded-full flex items-center justify-center"
        :class="status === 'error' ? 'bg-red-500' : 'bg-blue-500'"
      >
        <Loader2 v-if="status !== 'error'" class="h-8 w-8 text-white animate-spin" />
        <XCircle v-else class="h-8 w-8 text-white" />
      </div>
    </div>
    <CardTitle class="text-center">
      {{ status === "error" ? "Connection failed" : "Connecting your account…" }}
    </CardTitle>
    <CardDescription class="text-center">{{ message }}</CardDescription>
  </CardHeader>

  <CardContent v-if="status === 'error'">
    <Button class="w-full" @click="router.push('/')">Go to dashboard</Button>
  </CardContent>
</template>

<script setup lang="ts">
import { Loader2, XCircle } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useAuthStore } from "@/stores/auth";

// Public so the auth middleware doesn't bounce it; we gate on the store below so
// we can send unauthenticated merchants to login with a return path back here.
definePageMeta({
  layout: "auth",
  public: true,
});

useHead({ title: "Connect to Hay" });

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const status = ref<"loading" | "error">("loading");
const message = ref("Please wait while we connect your Hay account.");

onMounted(async () => {
  const redirectUri = route.query.redirect_uri as string | undefined;
  const state = route.query.state as string | undefined;

  if (!redirectUri) {
    status.value = "error";
    message.value = "This connection link is missing a redirect target.";
    return;
  }

  // Not signed in → send to login, then return to this exact authorize URL.
  if (!authStore.isAuthenticated) {
    router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`);
    return;
  }

  try {
    // Server validates redirect_uri against the allowlist and returns the
    // code-bearing redirect URL; we never see or build the code ourselves.
    const { redirectUrl } = await Hay.auth.generateConnectAuthCode.mutate({
      redirectUri,
      state,
    });
    window.location.href = redirectUrl;
  } catch (err: unknown) {
    status.value = "error";
    message.value =
      err instanceof Error ? err.message : "We couldn't complete the connection. Please try again.";
  }
});
</script>
