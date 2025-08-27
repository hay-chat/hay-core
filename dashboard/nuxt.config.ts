// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  devtools: { enabled: true },

  // Server configuration for local development
  devServer: {
    port: 5173,
  },

  // Runtime config for domain handling
  runtimeConfig: {
    public: {
      baseDomain:
        process.env["NODE_ENV"] === "development" ? "localhost:3000" : "hay.ai",
      apiBaseUrl:
        process.env["NODE_ENV"] === "development"
          ? "http://localhost:3000"
          : "https://api.hay.so",
    },
  },

  // Enable TypeScript
  typescript: {
    strict: true,
    typeCheck: true,
    tsConfig: {
      compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        paths: {
          "@server/*": ["../server/*"],
          "@/*": ["./*"],
        },
      },
      exclude: ["../server/**/*"],
    },
  },

  // CSS framework
  css: ["@/assets/css/main.css"],

  // Modules
  modules: [
    "@nuxtjs/tailwindcss",
    "@pinia/nuxt",
    "pinia-plugin-persistedstate/nuxt",
    "@vueuse/nuxt",
  ],

  // Auto-import configuration
  imports: {
    // Auto-import Vue, Nuxt and VueUse functions
    presets: [
      {
        from: "vue",
        imports: [
          "ref",
          "reactive",
          "computed",
          "watch",
          "watchEffect",
          "nextTick",
          "onMounted",
          "onUnmounted",
          "onBeforeMount",
          "onBeforeUnmount",
          "onActivated",
          "onDeactivated",
          "onErrorCaptured",
          "defineProps",
          "defineEmits",
          "defineExpose",
          "withDefaults",
          "provide",
          "inject",
          "readonly",
          "shallowRef",
          "shallowReactive",
          "toRef",
          "toRefs",
          "toRaw",
          "markRaw",
          "customRef",
          "triggerRef",
          "isRef",
          "isReactive",
          "isReadonly",
          "isProxy",
        ],
      },
    ],
    // Auto-import from directories
    dirs: [
      "composables",
      "composables/*/index.{ts,js,mjs,mts}",
      "composables/**",
      "utils",
      "utils/*/index.{ts,js,mjs,mts}",
      "utils/**",
      "stores",
      "stores/*/index.{ts,js,mjs,mts}",
      "stores/**",
    ],
  },

  // Auto-import components
  components: [
    {
      path: "@/components",
      pathPrefix: false,
      extensions: ["vue"],
      // Enable auto-import for all component subdirectories
      global: true,
    },
    {
      path: "@/components/ui",
      prefix: "",
      extensions: ["vue"],
    },
    {
      path: "@/components/auth",
      prefix: "",
      extensions: ["vue"],
    },
    {
      path: "@/components/layout",
      prefix: "",
      extensions: ["vue"],
    },
  ],

  // App configuration
  app: {
    head: {
      title: "Hay Dashboard",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "Hay platform dashboard application" },
      ],
    },
  },

  // Build configuration
  build: {
    transpile: ["@headlessui/vue"],
  },

  // Tailwind CSS configuration
  tailwindcss: {
    cssPath: "@/assets/css/main.css",
  },

  // Vite configuration for additional auto-imports
  vite: {
    optimizeDeps: {
      include: ["vue", "vue-router", "@vueuse/core"],
    },
  },
});
