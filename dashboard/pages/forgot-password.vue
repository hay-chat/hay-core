<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Success State -->
      <div v-if="emailSent" class="text-center space-y-4">
        <div class="mx-auto flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
          <CheckCircle class="w-6 h-6 text-green-600" />
        </div>

        <div>
          <CardTitle class="text-2xl"> Check your email </CardTitle>
          <CardDescription class="mt-2">
            We've sent a password reset link to
            <strong>{{ form.email }}</strong>
          </CardDescription>
        </div>

        <div class="space-y-4">
          <div class="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p class="text-sm text-blue-800">
              <strong>Didn't receive the email?</strong><br />
              Check your spam folder or try resending the link.
            </p>
          </div>

          <div class="space-y-3">
            <Button
              variant="outline"
              size="lg"
              class="w-full"
              :loading="resendLoading"
              :disabled="resendCooldown > 0"
              @click="resendEmail"
            >
              <span v-if="resendCooldown > 0">Resend in {{ resendCooldown }}s</span>
              <span v-else>Resend email</span>
            </Button>

            <Button variant="ghost" size="lg" class="w-full" @click="goBack">
              Back to sign in
            </Button>
          </div>
        </div>
      </div>

      <!-- Request Form -->
      <div v-else class="space-y-6">
        <!-- Header -->
        <div class="text-center">
          <CardTitle class="text-2xl"> Forgot your password? </CardTitle>
          <CardDescription class="mt-2">
            Enter your email address and we'll send you a link to reset your password.
          </CardDescription>
        </div>

        <!-- Reset Form -->
        <form class="space-y-4" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <Input
              id="email"
              v-model="form.email"
              label="Email address"
              type="email"
              placeholder="Enter your email"
              required
              :class="errors.email ? 'border-red-500' : ''"
              @blur="validateField('email')"
            />
            <p v-if="errors.email" class="text-sm text-red-600">
              {{ errors.email }}
            </p>
            <p v-else class="text-sm text-gray-500">
              We'll send a reset link to this email address
            </p>
          </div>

          <!-- Submit Button -->
          <Button
            type="submit"
            size="lg"
            class="w-full"
            :loading="loading"
            :disabled="!isFormValid"
          >
            Send reset link
          </Button>

          <!-- Error Message -->
          <div v-if="error" class="p-3 rounded-md bg-red-50 border border-red-200">
            <p class="text-sm text-red-800">
              {{ error }}
            </p>
          </div>
        </form>

        <!-- Back to login -->
        <div class="text-center">
          <NuxtLink
            to="/login"
            class="text-sm text-primary hover:text-primary/80 font-medium flex items-center justify-center space-x-1"
          >
            <ArrowLeft class="w-4 h-4" />
            <span>Back to sign in</span>
          </NuxtLink>
        </div>
      </div>

      <!-- Help Section -->
      <div class="border-t pt-6">
        <div class="text-center space-y-2">
          <p class="text-sm text-gray-600">Need help?</p>
          <div class="space-x-4">
            <NuxtLink to="/support" class="text-sm text-primary hover:text-primary/80 font-medium">
              Contact Support
            </NuxtLink>
            <NuxtLink to="/help" class="text-sm text-primary hover:text-primary/80 font-medium">
              Help Center
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { CheckCircle, ArrowLeft } from "lucide-vue-next";
import { validateEmail } from "@/lib/utils";

// TODO: Import authentication composable/store
// TODO: Import router for navigation

definePageMeta({
  layout: false,
  public: true,
});

// Form state
const form = reactive({
  email: "",
});

const errors = reactive({
  email: "",
});

const loading = ref(false);
const error = ref("");
const emailSent = ref(false);
const resendLoading = ref(false);
const resendCooldown = ref(0);

// Computed
const isFormValid = computed(() => {
  return form.email && validateEmail(form.email) && !errors.email;
});

// Methods
const validateField = (field: keyof typeof errors) => {
  switch (field) {
    case "email":
      if (!form.email) {
        errors.email = "Email is required";
      } else if (!validateEmail(form.email)) {
        errors.email = "Please enter a valid email address";
      } else {
        errors.email = "";
      }
      break;
  }
};

const handleSubmit = async () => {
  validateField("email");

  if (!isFormValid.value) {
    return;
  }

  loading.value = true;
  error.value = "";

  try {
    // TODO: Implement password reset request logic
    // TODO: Call password reset API endpoint
    // TODO: Handle different response scenarios
    // TODO: Log password reset attempt for security

    console.log("Password reset request for:", form.email);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // TODO: Handle successful password reset request
    emailSent.value = true;
  } catch (err) {
    // TODO: Handle different types of errors
    // TODO: Show appropriate error messages
    // TODO: Handle rate limiting
    error.value = "Failed to send reset email. Please try again.";
    console.error("Password reset error:", err);
  } finally {
    loading.value = false;
  }
};

const resendEmail = async () => {
  resendLoading.value = true;

  try {
    // TODO: Implement resend logic
    // TODO: Check rate limiting on server side
    // TODO: Update resend timestamp

    console.log("Resending password reset email to:", form.email);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Start cooldown timer
    startResendCooldown();
  } catch (err) {
    error.value = "Failed to resend email. Please try again.";
    console.error("Resend error:", err);
  } finally {
    resendLoading.value = false;
  }
};

const startResendCooldown = () => {
  resendCooldown.value = 60; // 60 seconds cooldown

  const interval = setInterval(() => {
    resendCooldown.value--;

    if (resendCooldown.value <= 0) {
      clearInterval(interval);
    }
  }, 1000);
};

const goBack = () => {
  // TODO: Use router navigation
  // await $router.push('/login')
  emailSent.value = false;
  form.email = "";
  errors.email = "";
  error.value = "";
};

// Auto-focus email input when component mounts
onMounted(() => {
  const emailInput = document.getElementById("email");
  if (emailInput && !emailSent.value) {
    emailInput.focus();
  }
});

// SEO
useHead({
  title: "Forgot Password - Hay Dashboard",
  meta: [
    {
      name: "description",
      content: "Reset your Hay dashboard account password",
    },
  ],
});
</script>
