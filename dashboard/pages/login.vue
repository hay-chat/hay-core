<template>
  <NuxtLayout name="auth">
    <div class="space-y-6">
      <!-- Header -->
      <div class="text-center">
        <CardTitle class="text-2xl"> Welcome back </CardTitle>
        <CardDescription class="mt-2"> Sign in to your account to continue </CardDescription>
      </div>

      <!-- Social Login -->
      <!-- <div class="space-y-3">
        <SocialButton
          provider="google"
          action="login"
          :loading="socialLoading.google"
          @click="handleSocialLogin"
        />
        <SocialButton
          provider="github"
          action="login"
          :loading="socialLoading.github"
          @click="handleSocialLogin"
        />
        <SocialButton
          provider="microsoft"
          action="login"
          :loading="socialLoading.microsoft"
          @click="handleSocialLogin"
        />
      </div> -->

      <!-- Divider -->
      <!-- <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <span class="w-full border-t" />
        </div>
        <div class="relative flex justify-center text-xs uppercase">
          <span class="bg-white px-2 text-neutral-muted"> Or continue with email </span>
        </div>
      </div> -->

      <!-- Login Form -->
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
        </div>

        <div class="space-y-2">
          <Input
            id="password"
            v-model="form.password"
            label="Password"
            type="password"
            placeholder="Enter your password"
            required
            :class="errors.password ? 'border-red-500' : ''"
            @blur="validateField('password')"
          />
          <p v-if="errors.password" class="text-sm text-red-600">
            {{ errors.password }}
          </p>
        </div>

        <!-- Remember me and Forgot password -->
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Checkbox id="remember" v-model:checked="form.rememberMe" />
            <Label for="remember" class="text-sm text-gray-700 cursor-pointer"> Remember me </Label>
          </div>
          <NuxtLink
            to="/forgot-password"
            class="text-sm text-primary hover:text-primary/80 font-medium"
          >
            Forgot password?
          </NuxtLink>
        </div>

        <!-- Submit Button -->
        <Button type="submit" size="lg" class="w-full" :loading="loading" :disabled="!isFormValid">
          Sign in
        </Button>

        <!-- Error Message -->
        <div v-if="error" class="p-3 rounded-md bg-red-50 border border-red-200">
          <p class="text-sm text-red-800">
            {{ error }}
          </p>
        </div>
      </form>

      <!-- Sign up link -->
      <div class="text-center">
        <p class="text-sm text-gray-600">
          Don't have an account?
          <NuxtLink to="/signup" class="font-medium text-primary hover:text-primary/80">
            Sign up
          </NuxtLink>
        </p>
      </div>
    </div>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { validateEmail } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

definePageMeta({
  layout: false,
  public: true,
});

// Navigation
const router = useRouter();

// Auth store
const authStore = useAuthStore();

// Form state
const form = reactive({
  email: "",
  password: "",
  rememberMe: false,
});

const errors = reactive({
  email: "",
  password: "",
});

const error = ref("");

// Computed
const loading = computed(() => authStore.isLoading);

const isFormValid = computed(() => {
  return (
    form.email && form.password && validateEmail(form.email) && !errors.email && !errors.password
  );
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
    case "password":
      if (!form.password) {
        errors.password = "Password is required";
      } else if (form.password.length < 8) {
        errors.password = "Password must be at least 8 characters";
      } else {
        errors.password = "";
      }
      break;
  }
};

const handleSubmit = async () => {
  // Validate all fields
  validateField("email");
  validateField("password");

  if (!isFormValid.value) {
    return;
  }

  error.value = "";

  try {
    await authStore.login(form.email, form.password);

    // Successful login - redirect to dashboard
    await router.push("/");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    // Handle different types of authentication errors
    if (err.message.includes("Invalid credentials")) {
      error.value = "Invalid email or password. Please check your credentials and try again.";
    } else if (err.message.includes("locked")) {
      error.value =
        "Your account has been temporarily locked due to multiple failed login attempts. Please try again later.";
    } else if (err.message.includes("suspended")) {
      error.value = "Your account has been suspended. Please contact support for assistance.";
    } else {
      error.value = "Unable to sign in. Please check your internet connection and try again.";
    }
    console.error("Login error:", err);
  }
};

// SEO
useHead({
  title: "Sign In - Hay Dashboard",
  meta: [{ name: "description", content: "Sign in to your Hay dashboard account" }],
});
</script>
