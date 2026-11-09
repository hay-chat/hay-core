<template>
  <CardHeader>
    <div class="flex justify-center mb-4">
      <div
        class="w-16 h-16 rounded-full flex items-center justify-center"
        :class="failed ? 'bg-red-500' : 'bg-blue-500'"
      >
        <XCircle v-if="failed" class="h-8 w-8 text-white" />
        <Loader2 v-else class="h-8 w-8 text-white animate-spin" />
      </div>
    </div>
    <CardTitle class="text-center">
      {{ failed ? $t("login.sso.failedTitle") : $t("login.sso.signingIn") }}
    </CardTitle>
    <CardDescription v-if="failed" class="text-center">
      {{ $t("login.sso.errors.state_invalid") }}
    </CardDescription>
  </CardHeader>

  <CardContent v-if="failed">
    <Button class="w-full" @click="router.push('/login')">{{ $t("login.sso.backToLogin") }}</Button>
  </CardContent>
</template>

<script setup lang="ts">
import { Loader2, XCircle } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: "auth",
  public: true,
});

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const failed = ref(false);

// The ticket is spent by the exchange; take it out of the address bar and history first.
const ticket = typeof route.query.ticket === "string" ? route.query.ticket : "";

onMounted(async () => {
  if (!ticket) {
    failed.value = true;
    return;
  }
  await router.replace({ path: route.path });
  try {
    const { challengeToken } = await authStore.completeSsoLogin(ticket);
    // A second factor is asked for on the login page, which picks up the challenge.
    await router.replace(challengeToken ? "/login" : "/");
  } catch {
    failed.value = true;
  }
});
</script>
