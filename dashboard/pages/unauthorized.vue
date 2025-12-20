<template>
  <Page title="Access Denied" description="You don't have permission to access this page">
    <Card class="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div class="p-3 bg-destructive/10 rounded-full">
            <ShieldAlert class="h-6 w-6 text-destructive" />
          </div>
          <div>
            <CardTitle>Permission Denied</CardTitle>
            <CardDescription
              >You don't have the necessary permissions to access this page</CardDescription
            >
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">
            This page requires {{ requiredRole }} permissions. Your current role in
            <strong>{{ currentOrganization?.name || "this organization" }}</strong>
            is <strong>{{ currentRole }}</strong
            >.
          </p>

          <div class="bg-muted/50 p-4 rounded-lg">
            <h4 class="font-medium mb-2 text-sm">What you can do:</h4>
            <ul class="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Contact your organization admin to request elevated permissions</li>
              <li>Switch to a different organization where you have the required access</li>
              <li>Return to the dashboard to access features available to your role</li>
            </ul>
          </div>

          <div class="flex gap-2 pt-2">
            <Button variant="default" @click="goToDashboard"> Go to Dashboard </Button>
            <Button variant="outline" @click="goBack"> Go Back </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { ShieldAlert } from "lucide-vue-next";
import { useUserStore } from "@/stores/user";
import { computed } from "vue";

definePageMeta({
  public: false,
});

const userStore = useUserStore();
const router = useRouter();
const route = useRoute();

const currentOrganization = computed(() => userStore.currentOrganization);
const currentRole = computed(() => userStore.userRole);

// Determine what role would be required for this page
const requiredRole = computed(() => {
  const attemptedPath = route.query.from as string;

  if (!attemptedPath) {
    return "admin or owner";
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
    return "admin or owner";
  }

  if (attemptedPath.includes("/agents/create") || attemptedPath.includes("/playbooks/create")) {
    return "contributor, admin, or owner";
  }

  return "higher";
});

const goToDashboard = () => {
  router.push("/dashboard");
};

const goBack = () => {
  router.back();
};
</script>
