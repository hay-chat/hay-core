<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Loading State -->
      <div v-if="loading">
        <Loading label="Loading invitation..." />
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="space-y-4">
        <div class="text-center">
          <CardTitle class="text-2xl text-red-600">Invalid Invitation</CardTitle>
          <CardDescription class="mt-2">{{ error }}</CardDescription>
        </div>
        <div class="flex justify-center">
          <Button @click="router.push('/login')"> Go to Login </Button>
        </div>
      </div>

      <!-- Invitation Details -->
      <div v-else-if="invitation" class="space-y-6">
        <!-- Header -->
        <div class="text-center space-y-2">
          <CardTitle class="text-2xl">Organization Invitation</CardTitle>
          <CardDescription>
            You've been invited to join <strong>{{ invitation.organization.name }}</strong>
          </CardDescription>
        </div>

        <!-- Invitation Info Card -->
        <div class="border rounded-lg p-6 space-y-4 bg-gray-50">
          <div class="space-y-3">
            <div>
              <p class="text-sm text-gray-600">Role</p>
              <p class="font-medium capitalize">{{ invitation.role }}</p>
            </div>
            <div v-if="invitation.invitedBy">
              <p class="text-sm text-gray-600">Invited by</p>
              <p class="font-medium">{{ invitation.invitedBy.name }}</p>
              <p class="text-sm text-gray-500">{{ invitation.invitedBy.email }}</p>
            </div>
            <div v-if="invitation.message">
              <p class="text-sm text-gray-600">Message</p>
              <p class="text-sm">{{ invitation.message }}</p>
            </div>
            <div>
              <p class="text-sm text-gray-600">Expires</p>
              <p class="text-sm">{{ formatDate(invitation.expiresAt) }}</p>
            </div>
          </div>
        </div>

        <!-- User not authenticated - redirecting... -->
        <div v-if="!authStore.isAuthenticated && invitation.canAccept" class="space-y-4">
          <div class="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p class="text-sm text-blue-800">Redirecting you to continue...</p>
          </div>
        </div>

        <!-- User authenticated - show accept/decline buttons or error message -->
        <div v-else class="space-y-4">
          <!-- Accept/Decline buttons - only show if invitation can be accepted -->
          <div v-if="invitation.canAccept" class="flex flex-col sm:flex-row gap-3">
            <Button
              size="lg"
              class="flex-1"
              :loading="accepting"
              :disabled="declining"
              @click="handleAccept"
            >
              Accept Invitation
            </Button>
            <Button
              size="lg"
              variant="outline"
              class="flex-1"
              :loading="declining"
              :disabled="accepting"
              @click="handleDecline"
            >
              Decline
            </Button>
          </div>

          <!-- Cannot accept message -->
          <div v-else>
            <Alert
              :variant="invitation.status === 'accepted' ? 'info' : 'destructive'"
              class="border-2"
            >
              <AlertDescription>
                <span v-if="invitation.status === 'accepted'">
                  This invitation has already been accepted. You should now have access to the
                  organization.
                </span>
                <span v-else-if="invitation.status === 'expired'">
                  This invitation has expired. Please request a new invitation from the organization
                  administrator.
                </span>
                <span v-else-if="invitation.status === 'declined'">
                  This invitation was declined. If you changed your mind, please contact the
                  organization administrator for a new invitation.
                </span>
                <span v-else-if="invitation.status === 'cancelled'">
                  This invitation was cancelled by the organization administrator.
                </span>
                <span v-else>
                  This invitation cannot be accepted (status: {{ invitation.status }})
                </span>
              </AlertDescription>
            </Alert>

            <!-- Go to Dashboard button for accepted invitations -->
            <div v-if="invitation.status === 'accepted'" class="mt-4 flex justify-center">
              <Button @click="router.push('/')"> Go to Dashboard </Button>
            </div>
          </div>
        </div>

        <!-- Success Message -->
        <div v-if="successMessage" class="p-3 rounded-md bg-green-50 border border-green-200">
          <p class="text-sm text-green-800">{{ successMessage }}</p>
        </div>

        <!-- Error Message -->
        <div v-if="actionError" class="p-3 rounded-md bg-red-50 border border-red-200">
          <p class="text-sm text-red-800">{{ actionError }}</p>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { Hay } from "@/utils/api";
import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

definePageMeta({
  layout: false,
  public: true,
});

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const userStore = useUserStore();

const token = computed(() => route.query.token as string);
const loading = ref(true);
const accepting = ref(false);
const declining = ref(false);
const error = ref("");
const actionError = ref("");
const successMessage = ref("");

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  message?: string;
  organization: {
    id: string;
    name: string;
    logo?: string;
  };
  invitedBy?: {
    name: string;
    email: string;
  };
  canAccept: boolean;
  isExistingUser: boolean;
}

const invitation = ref<Invitation | null>(null);

// Format date helper
const formatDate = (dateString: string) => {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(dateString));
};

// Load invitation details
const loadInvitation = async () => {
  if (!token.value) {
    error.value = "No invitation token provided";
    loading.value = false;
    return;
  }

  try {
    loading.value = true;
    error.value = "";

    const result = await Hay.invitations.getInvitationByToken.query({
      token: token.value,
    });

    invitation.value = result as Invitation;

    // Smart redirect for unauthenticated users - only if invitation can still be accepted
    if (!authStore.isAuthenticated && invitation.value.canAccept) {
      const redirectUrl = `/accept-invitation?token=${token.value}`;
      if (invitation.value.isExistingUser) {
        // Existing user - redirect to login
        await router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
      } else {
        // New user - redirect to signup
        await router.push(`/signup?redirect=${encodeURIComponent(redirectUrl)}`);
      }
    }
  } catch (err) {
    console.error("Failed to load invitation:", err);
    error.value =
      err instanceof Error
        ? err.message
        : "Failed to load invitation. The link may be invalid or expired.";
  } finally {
    loading.value = false;
  }
};

// Accept invitation
const handleAccept = async () => {
  if (!token.value || !invitation.value) return;

  try {
    accepting.value = true;
    actionError.value = "";

    const result = await Hay.invitations.acceptInvitation.mutate({
      token: token.value,
    });

    if (result.success) {
      successMessage.value = `Successfully joined ${result.data.organizationName}!`;

      // Add the organization to the user's list
      userStore.organizations.push({
        id: result.data.organizationId,
        name: result.data.organizationName,
        slug: result.data.organizationId, // Use ID as slug temporarily
        role: result.data.role,
      });

      // Set as the active organization
      userStore.setActiveOrganization(result.data.organizationId);

      // Redirect immediately
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    }
  } catch (err) {
    console.error("Failed to accept invitation:", err);
    actionError.value =
      err instanceof Error ? err.message : "Failed to accept invitation. Please try again.";
  } finally {
    accepting.value = false;
  }
};

// Decline invitation
const handleDecline = async () => {
  if (!token.value) return;

  try {
    declining.value = true;
    actionError.value = "";

    const result = await Hay.invitations.declineInvitation.mutate({
      token: token.value,
    });

    if (result.success) {
      successMessage.value = "Invitation declined.";

      // Redirect after a short delay
      setTimeout(() => {
        router.push(authStore.isAuthenticated ? "/" : "/login");
      }, 2000);
    }
  } catch (err) {
    console.error("Failed to decline invitation:", err);
    actionError.value =
      err instanceof Error ? err.message : "Failed to decline invitation. Please try again.";
  } finally {
    declining.value = false;
  }
};

// Check if logged in user matches invitation email
const checkEmailMatch = async () => {
  if (
    authStore.isAuthenticated &&
    userStore.user?.email &&
    invitation.value?.email &&
    userStore.user.email.toLowerCase() !== invitation.value.email.toLowerCase()
  ) {
    // Email mismatch - log out the user and redirect to login/signup with invitation context
    const redirectUrl = `/accept-invitation?token=${token.value}`;

    // Clear auth state without using logout() to avoid automatic redirect
    authStore.tokens = null;
    authStore.isAuthenticated = false;
    userStore.clearUser();

    // Redirect based on whether the invitation is for an existing user
    if (invitation.value.isExistingUser) {
      await router.push(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
    } else {
      await router.push(`/signup?redirect=${encodeURIComponent(redirectUrl)}`);
    }
  }
};

// Load invitation on mount
onMounted(() => {
  loadInvitation();
});

// Watch for token changes (e.g., if navigating back from login)
watch(token, () => {
  if (token.value) {
    loadInvitation();
  }
});

// Watch for invitation changes to check email match
watch(invitation, () => {
  if (invitation.value) {
    checkEmailMatch();
  }
});

// Watch for auth state changes
watch(
  () => authStore.isAuthenticated,
  () => {
    if (authStore.isAuthenticated && invitation.value) {
      checkEmailMatch();
    }
  },
);

// SEO
useHead({
  title: "Accept Invitation - Hay Dashboard",
  meta: [{ name: "description", content: "Accept your organization invitation" }],
});
</script>
