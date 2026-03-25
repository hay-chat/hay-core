<template>
  <CardHeader>
    <div class="flex justify-center mb-4">
      <div
        class="w-16 h-16 rounded-full flex items-center justify-center"
        :class="status === 'loading' ? 'bg-blue-500' : 'bg-red-500'"
      >
        <Loader2 v-if="status === 'loading'" class="h-8 w-8 text-white animate-spin" />
        <XCircle v-else class="h-8 w-8 text-white" />
      </div>
    </div>
    <CardTitle class="text-center">
      {{ status === "loading" ? "Signing you in..." : "Sign In Failed" }}
    </CardTitle>
    <CardDescription class="text-center">
      {{
        status === "loading"
          ? "Please wait while we verify your access code."
          : status === "missing"
            ? "No access code was provided in this link."
            : errorMessage
      }}
    </CardDescription>
  </CardHeader>

  <CardContent v-if="status !== 'loading'">
    <Button class="w-full" @click="router.push('/login')">Go to Login</Button>
  </CardContent>
</template>

<script setup lang="ts">
import { Loader2, XCircle } from "lucide-vue-next";
import { HayAuthApi } from "@/utils/api";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: "auth",
  public: true,
});

useHead({
  title: "Sign In - Hay",
});

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const code = computed(() => route.query.code as string | undefined);
const status = ref<"loading" | "error" | "missing">("loading");
const errorMessage = ref("");

onMounted(async () => {
  if (!code.value) {
    status.value = "missing";
    return;
  }

  try {
    const result = await HayAuthApi.auth.exchangeAuthCode.mutate({
      code: code.value,
    });

    await authStore.loginWithTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    });

    await router.push("/");
  } catch (err: unknown) {
    status.value = "error";
    errorMessage.value =
      err instanceof Error ? err.message : "The access code is invalid or has already been used.";
  }
});
</script>
