<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-lg">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div class="p-3 bg-destructive/10 rounded-full">
            <ShieldAlert class="h-6 w-6 text-destructive" />
          </div>
          <div>
            <CardTitle>{{ $t("noAccess.title") }}</CardTitle>
            <CardDescription>{{ $t("noAccess.description") }}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="space-y-6">
        <p v-if="userStore.user?.email" class="text-sm text-muted-foreground">
          {{ $t("noAccess.signedInAs", { email: userStore.user.email }) }}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button v-if="userStore.organizations.length" @click="router.push('/')">
            {{ $t("noAccess.goToMyOrganization") }}
          </Button>
          <Button variant="outline" @click="useAnotherAccount">
            {{ $t("noAccess.useAnotherAccount") }}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ShieldAlert } from "lucide-vue-next";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";
import { safeInternalPath } from "@/utils/safe-internal-path";

definePageMeta({
  layout: "empty",
});

const userStore = useUserStore();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

/** The link may be meant for another account: sign out and come back to it. */
const useAnotherAccount = async () => {
  const redirect = safeInternalPath(route.query.redirect);
  await authStore.logout();
  await router.replace({ path: "/login", query: { redirect } });
};
</script>
