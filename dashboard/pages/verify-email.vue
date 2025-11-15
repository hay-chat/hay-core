<template>
  <CardHeader>
    <div class="flex justify-center mb-4">
      <div class="w-16 h-16 rounded-full flex items-center justify-center" :class="statusColor">
        <component :is="statusIcon" class="h-8 w-8 text-white" />
      </div>
    </div>
    <CardTitle class="text-center">{{ title }}</CardTitle>
    <CardDescription class="text-center">{{ description }}</CardDescription>
  </CardHeader>

  <CardContent class="space-y-4">
    <!-- Loading State -->
    <div v-if="isVerifying" class="py-8">
      <Loading label="Verifying your email address..." />
    </div>

    <!-- Success State -->
    <div v-else-if="verificationStatus === 'success'" class="text-center space-y-4">
      <Alert variant="default" class="border-green-200 bg-green-50">
        <AlertDescription class="text-green-800">
          Your email address has been successfully verified and updated!
        </AlertDescription>
      </Alert>

      <p class="text-sm text-neutral-muted">
        You can now use your new email address to log in to your account.
      </p>

      <div class="flex flex-col gap-2 pt-4">
        <Button @click="goToProfile" class="w-full"> Go to Profile </Button>
        <Button @click="goToLogin" variant="outline" class="w-full"> Go to Login </Button>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="verificationStatus === 'error'" class="text-center space-y-4">
      <Alert variant="destructive">
        <AlertDescription>
          {{ errorMessage }}
        </AlertDescription>
      </Alert>

      <p class="text-sm text-neutral-muted">
        {{ errorHint }}
      </p>

      <div class="flex flex-col gap-2 pt-4">
        <Button @click="goToProfile" class="w-full"> Go to Profile </Button>
        <Button @click="retry" variant="outline" class="w-full" v-if="token"> Try Again </Button>
      </div>
    </div>

    <!-- No Token State -->
    <div v-else class="text-center space-y-4">
      <Alert variant="destructive">
        <AlertDescription>
          No verification token provided. Please check your email for the verification link.
        </AlertDescription>
      </Alert>

      <Button @click="goToProfile" class="w-full"> Go to Profile </Button>
    </div>
  </CardContent>

  <CardFooter class="flex justify-center">
    <p class="text-xs text-neutral-muted">
      Need help? <a href="/support" class="text-primary hover:underline">Contact Support</a>
    </p>
  </CardFooter>
</template>

<script setup lang="ts">
import { CheckCircle, XCircle, Mail } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";
import { useUserStore } from "@/stores/user";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const userStore = useUserStore();

// Extract token from URL
const token = ref((route.query.token as string) || "");

// State
const isVerifying = ref(false);
const verificationStatus = ref<"pending" | "success" | "error">("pending");
const errorMessage = ref("");
const errorHint = ref("");

// Computed properties
const title = computed(() => {
  if (isVerifying.value) return "Verifying Email";
  if (verificationStatus.value === "success") return "Email Verified!";
  if (verificationStatus.value === "error") return "Verification Failed";
  return "Email Verification";
});

const description = computed(() => {
  if (isVerifying.value) return "Please wait while we verify your new email address...";
  if (verificationStatus.value === "success") return "Your email has been successfully updated";
  if (verificationStatus.value === "error") return "We couldn't verify your email address";
  return "Complete your email change";
});

const statusIcon = computed(() => {
  if (isVerifying.value) return Mail;
  if (verificationStatus.value === "success") return CheckCircle;
  return XCircle;
});

const statusColor = computed(() => {
  if (isVerifying.value) return "bg-blue-500";
  if (verificationStatus.value === "success") return "bg-green-500";
  return "bg-red-500";
});

// Verify email on mount
onMounted(async () => {
  if (token.value) {
    await verifyEmail();
  }
});

const verifyEmail = async () => {
  if (!token.value) return;

  isVerifying.value = true;
  verificationStatus.value = "pending";

  try {
    const response = await Hay.auth.verifyEmailChange.mutate({
      token: token.value,
    });

    if (response.success) {
      verificationStatus.value = "success";
      toast.success(response.message || "Email verified successfully!");

      // Refresh user data to clear pendingEmail from the store
      try {
        const userData = await Hay.auth.me.query();
        const userDataWithDates = {
          ...userData,
          lastSeenAt: userData.lastSeenAt ? new Date(userData.lastSeenAt) : undefined,
          lastLoginAt: userData.lastLoginAt ? new Date(userData.lastLoginAt) : undefined,
          organizations: userData.organizations?.map(org => ({
            ...org,
            joinedAt: org.joinedAt ? new Date(org.joinedAt) : undefined,
            lastAccessedAt: org.lastAccessedAt ? new Date(org.lastAccessedAt) : undefined,
          })),
        };
        userStore.setUser(userDataWithDates);
      } catch (error) {
        console.error("Failed to refresh user data after verification:", error);
      }
    }
  } catch (error: any) {
    console.error("Email verification failed:", error);
    verificationStatus.value = "error";
    errorMessage.value = error.message || "Failed to verify email address";

    // Provide helpful hints based on error
    if (error.message?.includes("expired")) {
      errorHint.value =
        "The verification link has expired. Please request a new email change from your profile settings.";
    } else if (error.message?.includes("Invalid")) {
      errorHint.value =
        "The verification link is invalid. Please check your email or request a new verification link.";
    } else {
      errorHint.value = "Please try again or contact support if the problem persists.";
    }
  } finally {
    isVerifying.value = false;
  }
};

const retry = async () => {
  await verifyEmail();
};

const goToProfile = () => {
  router.push("/settings/profile");
};

const goToLogin = () => {
  router.push("/login");
};

// Set page meta
definePageMeta({
  layout: "auth",
  public: true, // No auth required - users might be logged out when clicking the verification link
});

// Head management
useHead({
  title: "Verify Email - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Verify your new email address",
    },
  ],
});
</script>
