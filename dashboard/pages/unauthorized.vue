<template>
  <Page :title="$t('unauthorized.pageTitle')" :description="$t('unauthorized.pageDescription')">
    <Card class="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div class="p-3 bg-destructive/10 rounded-full">
            <ShieldAlert class="h-6 w-6 text-destructive" />
          </div>
          <div>
            <CardTitle>{{ $t("unauthorized.title") }}</CardTitle>
            <CardDescription>{{ $t("unauthorized.description") }}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">
            {{
              $t("unauthorized.requiresRole", {
                role: requiredRole,
                organization: currentOrganization?.name || $t("unauthorized.thisOrganization"),
                currentRole: currentRole,
              })
            }}
          </p>

          <div class="bg-muted/50 p-4 rounded-lg">
            <h4 class="font-medium mb-2 text-sm">{{ $t("unauthorized.whatYouCanDo") }}</h4>
            <ul class="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>{{ $t("unauthorized.contactAdmin") }}</li>
              <li>{{ $t("unauthorized.switchOrg") }}</li>
              <li>{{ $t("unauthorized.returnDashboard") }}</li>
            </ul>
          </div>

          <div class="flex gap-2 pt-2">
            <Button variant="default" @click="goToDashboard">
              {{ $t("common.goToDashboard") }}
            </Button>
            <Button variant="outline" @click="goBack">
              {{ $t("common.goBack") }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ShieldAlert } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { useUserStore } from "@/stores/user";
import { computed } from "vue";

definePageMeta({
  public: false,
});

const { t } = useI18n();
const userStore = useUserStore();
const router = useRouter();
const route = useRoute();

const currentOrganization = computed(() => userStore.currentOrganization);
const currentRole = computed(() => userStore.userRole);

// Determine what role would be required for this page
const requiredRole = computed(() => {
  const attemptedPath = route.query.from as string;

  if (!attemptedPath) {
    return t("unauthorized.roles.adminOrOwner");
  }

  // Map paths to required roles
  if (
    attemptedPath.includes("/settings/users") ||
    attemptedPath.includes("/settings/api-tokens") ||
    attemptedPath.includes("/settings/general") ||
    attemptedPath.includes("/settings/privacy") ||
    attemptedPath.includes("/settings/webchat") ||
    attemptedPath.includes("/agents") ||
    attemptedPath.includes("/integrations/marketplace")
  ) {
    return t("unauthorized.roles.adminOrOwner");
  }

  if (attemptedPath.includes("/agents/create") || attemptedPath.includes("/playbooks/create")) {
    return t("unauthorized.roles.contributorAdminOrOwner");
  }

  return t("unauthorized.roles.higher");
});

const goToDashboard = () => {
  router.push("/dashboard");
};

const goBack = () => {
  router.back();
};
</script>
