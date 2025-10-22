<template>
  <div class="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
    <Card class="max-w-lg w-full">
      <CardHeader>
        <div class="flex justify-center mb-4">
          <div
            :class="{
              'bg-blue-100': !error && !success,
              'bg-green-100': success,
              'bg-red-100': error,
            }"
            class="w-16 h-16 rounded-full flex items-center justify-center"
          >
            <Loader2 v-if="loading" class="h-8 w-8 text-blue-600 animate-spin" />
            <CheckCircle v-else-if="success" class="h-8 w-8 text-green-600" />
            <XCircle v-else-if="error" class="h-8 w-8 text-red-600" />
            <Shield v-else class="h-8 w-8 text-blue-600" />
          </div>
        </div>

        <CardTitle class="text-center">{{ title }}</CardTitle>
        <CardDescription class="text-center">{{ description }}</CardDescription>
      </CardHeader>

      <CardContent class="space-y-4">
        <!-- Loading State -->
        <div v-if="loading" class="text-center space-y-2">
          <p class="text-neutral-muted">Processing your request...</p>
          <div class="flex justify-center">
            <div class="w-48 h-2 bg-neutral-200 rounded-full overflow-hidden">
              <div class="h-full bg-blue-600 animate-pulse"></div>
            </div>
          </div>
        </div>

        <!-- Success State -->
        <div v-else-if="success" class="space-y-4">
          <Alert :icon="Mail">
            <AlertTitle>Request Confirmed</AlertTitle>
            <AlertDescription>{{ successMessage }}</AlertDescription>
          </Alert>

          <div v-if="requestType === 'export'" class="space-y-2">
            <h4 class="font-medium">What happens next?</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>We're generating your data export (typically takes less than 5 minutes)</li>
              <li>You'll receive an email with a download link when it's ready</li>
              <li>The download link will be valid for 7 days</li>
            </ul>
          </div>

          <div v-else-if="requestType === 'deletion'" class="space-y-2">
            <Alert variant="destructive">
              <AlertTriangle class="h-4 w-4" />
              <AlertTitle>Account Deletion in Progress</AlertTitle>
              <AlertDescription>
                Your account and data are being permanently deleted. You'll receive a confirmation
                email when the process is complete.
              </AlertDescription>
            </Alert>
          </div>

          <div class="flex justify-center pt-4">
            <Button @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
          </div>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle class="h-4 w-4" />
            <AlertTitle>Verification Failed</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>

          <div class="space-y-2">
            <h4 class="font-medium">Common issues:</h4>
            <ul class="list-disc list-inside text-sm text-neutral-muted space-y-1">
              <li>The verification link may have expired (valid for 24 hours)</li>
              <li>The link may have already been used</li>
              <li>The link may be invalid or corrupted</li>
            </ul>
          </div>

          <div class="flex justify-center space-x-2 pt-4">
            <Button variant="outline" @click="goToDashboard">
              <Home class="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
            <Button @click="requestNewLink">
              <RefreshCw class="h-4 w-4 mr-2" />
              Request New Link
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Hay } from "@/utils/api";
import {
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
  Mail,
  AlertTriangle,
  Home,
  RefreshCw,
} from "lucide-vue-next";

// Mark as public page - accessible without authentication
definePageMeta({
  public: true,
});

const route = useRoute();
const router = useRouter();

const loading = ref(true);
const success = ref(false);
const error = ref(false);
const successMessage = ref("");
const errorMessage = ref("");
const requestType = ref<"export" | "deletion" | null>(null);

const token = computed(() => route.query.token as string);
const type = computed(() => route.query.type as string);

const title = computed(() => {
  if (loading.value) return "Verifying Request...";
  if (success.value) return "Request Confirmed!";
  if (error.value) return "Verification Failed";
  return "Privacy Request Verification";
});

const description = computed(() => {
  if (loading.value) return "Please wait while we verify your privacy request";
  if (success.value) {
    if (requestType.value === "export") {
      return "Your data export request has been confirmed and is being processed";
    } else {
      return "Your account deletion request has been confirmed";
    }
  }
  if (error.value) return "We couldn't verify your privacy request";
  return "Confirm your privacy request";
});

const verifyRequest = async () => {
  if (!token.value || !type.value) {
    error.value = true;
    errorMessage.value = "Invalid verification link. Missing token or request type.";
    loading.value = false;
    return;
  }

  requestType.value = type.value as "export" | "deletion";

  try {
    loading.value = true;

    if (type.value === "export") {
      const result = await Hay.privacy.confirmExport.mutate({ token: token.value });
      success.value = true;
      successMessage.value = result.message;
    } else if (type.value === "deletion") {
      const result = await Hay.privacy.confirmDeletion.mutate({ token: token.value });
      success.value = true;
      successMessage.value = result.message;
    } else {
      throw new Error("Invalid request type");
    }
  } catch (err: unknown) {
    const apiError = err as {
      data?: { code?: string };
      code?: string;
      message?: string;
      error?: { message?: string };
    };

    // Provide more specific error messages based on error type
    const errorCode = apiError.data?.code || apiError.code;
    const errMessage =
      apiError.message || apiError.error?.message || "Failed to verify your request";

    if (errorCode === "TOO_MANY_REQUESTS" || errMessage.toLowerCase().includes("rate limit")) {
      errorMessage.value =
        "Too many verification attempts. Please wait a few minutes before trying again.";
    } else if (
      errorCode === "SERVICE_UNAVAILABLE" ||
      errMessage.toLowerCase().includes("unavailable")
    ) {
      errorMessage.value =
        "Privacy service is temporarily unavailable. Please try again in a few minutes.";
    } else if (errMessage.toLowerCase().includes("expired")) {
      errorMessage.value =
        "This verification link has expired. Please request a new privacy request from your settings.";
    } else if (
      errMessage.toLowerCase().includes("invalid") ||
      errMessage.toLowerCase().includes("token")
    ) {
      errorMessage.value =
        "Invalid or already used verification link. Please request a new privacy request if needed.";
    } else {
      errorMessage.value = errMessage || "Failed to verify your request. Please try again.";
    }

    error.value = true;
  } finally {
    loading.value = false;
  }
};

const goToDashboard = () => {
  router.push("/");
};

const requestNewLink = () => {
  router.push("/settings/privacy");
};

onMounted(() => {
  verifyRequest();
});
</script>
