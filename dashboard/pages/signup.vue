<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Header -->
      <div class="text-center">
        <CardTitle class="text-2xl"> Create your account </CardTitle>
        <CardDescription class="mt-2"> Get started with your Hay organization </CardDescription>
      </div>

      <!-- Social Signup -->
      <!-- <div class="space-y-3">
        <SocialButton
          provider="google"
          action="signup"
          :loading="socialLoading.google"
          @click="handleSocialSignup"
        />
        <SocialButton
          provider="github"
          action="signup"
          :loading="socialLoading.github"
          @click="handleSocialSignup"
        />
        <SocialButton
          provider="microsoft"
          action="signup"
          :loading="socialLoading.microsoft"
          @click="handleSocialSignup"
        />
      </div> -->

      <!-- Divider -->
      <!-- <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <span class="w-full border-t" />
        </div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-white px-2 text-neutral-muted"> Or create account with email </span>
        </div>
      </div> -->

      <!-- Signup Form -->
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Organization Name -->
        <div class="space-y-2">
          <Input
            id="organizationName"
            v-model="form.organizationName"
            label="Organization name"
            type="text"
            placeholder="Enter your organization name"
            required
            :class="errors.organizationName ? 'border-red-500' : ''"
            @blur="() => nextTick(() => validateField('organizationName'))"
          />
          <p v-if="errors.organizationName" class="text-sm text-red-600">
            {{ errors.organizationName }}
          </p>
          <p v-else class="text-sm text-gray-500">This will be used to identify your workspace</p>
        </div>

        <!-- Admin Email -->
        <div class="space-y-2">
          <Input
            id="email"
            v-model="form.email"
            label="Admin email address"
            type="email"
            placeholder="Enter your email"
            required
            :class="errors.email ? 'border-red-500' : ''"
            @blur="() => nextTick(() => validateField('email'))"
          />
          <p v-if="errors.email" class="text-sm text-red-600">
            {{ errors.email }}
          </p>
          <p v-else class="text-sm text-gray-500">This will be your admin account email</p>
        </div>

        <!-- Admin Full Name -->
        <div class="space-y-2">
          <Input
            id="fullName"
            v-model="form.fullName"
            label="Full name"
            type="text"
            placeholder="Enter your full name"
            required
            :class="errors.fullName ? 'border-red-500' : ''"
            @blur="() => nextTick(() => validateField('fullName'))"
          />
          <p v-if="errors.fullName" class="text-sm text-red-600">
            {{ errors.fullName }}
          </p>
        </div>

        <!-- Password -->
        <div class="space-y-2">
          <Input
            id="password"
            v-model="form.password"
            label="Password"
            type="password"
            placeholder="Create a strong password"
            required
            :class="errors.password ? 'border-red-500' : ''"
            @blur="() => nextTick(() => validateField('password'))"
          />
          <p v-if="errors.password" class="text-sm text-red-600">
            {{ errors.password }}
          </p>
        </div>

        <!-- Password Strength Indicator -->
        <PasswordStrength :password="form.password" />

        <!-- Confirm Password -->
        <div class="space-y-2">
          <Input
            id="confirmPassword"
            v-model="form.confirmPassword"
            label="Confirm password"
            type="password"
            placeholder="Confirm your password"
            required
            :class="errors.confirmPassword ? 'border-red-500' : ''"
            @blur="() => nextTick(() => validateField('confirmPassword'))"
          />
          <p v-if="errors.confirmPassword" class="text-sm text-red-600">
            {{ errors.confirmPassword }}
          </p>
        </div>

        <!-- Terms and Privacy Agreement -->
        <div class="space-y-3">
          <div class="flex items-start space-x-2">
            <Checkbox id="terms" v-model:checked="form.acceptTerms" class="mt-1" />
            <Label for="terms" class="text-sm text-gray-700 cursor-pointer leading-5">
              I agree to the
              <NuxtLink to="/terms" class="text-primary hover:text-primary/80 font-medium">
                Terms of Service
              </NuxtLink>
              and
              <NuxtLink to="/privacy" class="text-primary hover:text-primary/80 font-medium">
                Privacy Policy
              </NuxtLink>
            </Label>
          </div>

          <div class="flex items-start space-x-2">
            <Checkbox id="marketing" v-model:checked="form.acceptMarketing" class="mt-1" />
            <Label for="marketing" class="text-sm text-gray-700 cursor-pointer leading-5">
              I would like to receive product updates and marketing communications
              <span class="text-gray-500">(optional)</span>
            </Label>
          </div>
        </div>

        <!-- Submit Button -->
        <Button
          type="submit"
          size="lg"
          class="w-full"
          :loading="authStore.isLoading"
          :disabled="!isFormValid"
        >
          Create account
        </Button>

        <!-- Error Message -->
        <div v-if="error" class="p-3 rounded-md bg-red-50 border border-red-200">
          <p class="text-sm text-red-800">
            {{ error }}
          </p>
        </div>
      </form>

      <!-- Login link -->
      <div class="text-center">
        <p class="text-sm text-gray-600">
          Already have an account?
          <NuxtLink to="/login" class="font-medium text-primary hover:text-primary/80">
            Sign in
          </NuxtLink>
        </p>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { nextTick } from "vue";
import { validateEmail, validatePassword } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: false,
  public: true,
});

// Navigation
const router = useRouter();

// Auth composable - wrapped to handle SSR
const authStore = useAuthStore();

// Form state
const form = reactive({
  organizationName: "",
  email: "",
  fullName: "",
  password: "",
  confirmPassword: "",
  acceptTerms: true,
  acceptMarketing: true,
});

const errors = reactive({
  organizationName: "",
  email: "",
  fullName: "",
  password: "",
  confirmPassword: "",
});

const error = ref("");

const _socialLoading = reactive({
  google: false,
  github: false,
  microsoft: false,
});

const passwordValidation = computed(() => validatePassword(form.password));

const isFormValid = computed(() => {
  return (
    form.organizationName &&
    form.email &&
    form.fullName &&
    form.password &&
    form.confirmPassword &&
    form.acceptTerms &&
    validateEmail(form.email) &&
    passwordValidation.value.isValid &&
    form.password === form.confirmPassword &&
    !Object.values(errors).some((error) => error)
  );
});

// Methods
const validateField = (field: keyof typeof errors) => {
  switch (field) {
    case "organizationName":
      if (!form.organizationName) {
        errors.organizationName = "Organization name is required";
      } else if (form.organizationName.length < 2) {
        errors.organizationName = "Organization name must be at least 2 characters";
      } else {
        errors.organizationName = "";
      }
      break;

    case "email":
      if (!form.email) {
        errors.email = "Email is required";
      } else if (!validateEmail(form.email)) {
        errors.email = "Please enter a valid email address";
      } else {
        errors.email = "";
      }
      break;

    case "fullName":
      if (!form.fullName) {
        errors.fullName = "Full name is required";
      } else if (form.fullName.length < 2) {
        errors.fullName = "Full name must be at least 2 characters";
      } else {
        errors.fullName = "";
      }
      break;

    case "password":
      if (!form.password) {
        errors.password = "Password is required";
      } else if (!passwordValidation.value.isValid) {
        errors.password = "Password does not meet requirements";
      } else {
        errors.password = "";
      }
      // Re-validate confirm password if it's been filled
      if (form.confirmPassword) {
        validateField("confirmPassword");
      }
      break;

    case "confirmPassword":
      if (!form.confirmPassword) {
        errors.confirmPassword = "Please confirm your password";
      } else if (form.password !== form.confirmPassword) {
        errors.confirmPassword = "Passwords do not match";
      } else {
        errors.confirmPassword = "";
      }
      break;
  }
};

const handleSubmit = async () => {
  // Validate all fields
  Object.keys(errors).forEach((field) => {
    validateField(field as keyof typeof errors);
  });

  if (!form.acceptTerms) {
    error.value = "You must accept the Terms of Service to continue";
    return;
  }

  if (!isFormValid.value) {
    return;
  }

  error.value = "";

  try {
    await authStore.signup({
      organizationName: form.organizationName,
      email: form.email,
      fullName: form.fullName,
      password: form.password,
      acceptTerms: form.acceptTerms,
      acceptMarketing: form.acceptMarketing,
    });

    // Successful signup - redirect to dashboard
    await router.push("/");
  } catch (err) {
    // Handle different types of registration errors
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("already exists")) {
      error.value =
        "An account with this email address already exists. Please try signing in instead.";
    } else if (errorMessage.includes("Password")) {
      error.value =
        "Password does not meet security requirements. Please choose a stronger password.";
    } else {
      error.value = "Unable to create your account. Please check your information and try again.";
    }
    console.error("Signup error:", err);
  }
};

// SEO
useHead({
  title: "Sign Up - Hay Dashboard",
  meta: [{ name: "description", content: "Create your Hay organization account" }],
});
</script>
