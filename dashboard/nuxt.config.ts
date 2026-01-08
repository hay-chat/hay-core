// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2025-09-19",
  devtools: { enabled: true },
  ssr: false,

  // Server configuration for local development
  devServer: {
    port: 3000,
  },

  // Runtime config for domain handling
  runtimeConfig: {
    public: {
      baseDomain: process.env["NODE_ENV"] === "development" ? "localhost:3000" : "hay.chat",
      apiDomain:
        process.env["API_DOMAIN"] ||
        (process.env["NODE_ENV"] === "development" ? "localhost:3001" : "api.hay.chat"),
      useSSL: process.env["USE_SSL"] === "true" || process.env["NODE_ENV"] === "production",
      apiBaseUrl:
        process.env["API_BASE_URL"] ||
        (() => {
          const useSSL =
            process.env["USE_SSL"] === "true" || process.env["NODE_ENV"] === "production";
          const apiDomain =
            process.env["API_DOMAIN"] ||
            (process.env["NODE_ENV"] === "development" ? "localhost:3001" : "api.hay.chat");
          const protocol = useSSL ? "https" : "http";
          return `${protocol}://${apiDomain}`;
        })(),
    },
  },

  // Enable TypeScript
  typescript: {
    strict: true,
    typeCheck: process.env["NODE_ENV"] !== "production", // Disable type check in production builds
    tsConfig: {
      compilerOptions: {
        module: "esnext",
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: ["vite/client"],
        paths: {
          "@server/*": ["../server/*"],
          "@/*": ["./*"],
          "~/*": ["./*"],
        },
      },

      // Only include dashboard files - no server files at all
      include: ["./**/*.ts", "./**/*.vue", "./**/*.js", "./**/*.mjs"],
      exclude: [
        "node_modules",
        ".nuxt",
        ".output",
        "dist",
        "../server/**/*", // Exclude ALL server files
        "../plugins/**/*", // Exclude plugins
        "**/*.spec.ts",
        "**/*.test.ts",
      ],
    },
  },

  // CSS framework
  css: ["@/assets/css/main.css"],

  // Modules
  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt", "@vueuse/nuxt"],

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
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Gabarito:wght@400..900&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
        },
      ],
    },
  },

  // Build configuration
  build: {
    transpile: ["@headlessui/vue"],
  },

  // Vite configuration for additional auto-imports
  vite: {
    optimizeDeps: {
      include: ["vue", "vue-router", "@vueuse/core"],
    },
    resolve: {
      alias: {
        // Enable runtime compilation for inline templates
        vue: "vue/dist/vue.esm-bundler.js",
        // Add alias for plugins directory
        "@plugins": "../plugins",
      },
    },
    server: {
      fs: {
        // Allow serving files from one level up to access plugins directory
        allow: [".."],
      },
      hmr: {
        // Suppress connection errors during HMR
        overlay: false,
      },
      watch: {
        // Reduce file watching overhead
        usePolling: false,
        interval: 100,
      },
    },
    define: {
      // Enable Vue runtime compilation
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
    },
  },

  // Enable Vue runtime compilation
  vue: {
    compilerOptions: {
      // This allows runtime compilation of templates
      isCustomElement: (_tag: string) => false,
    },
    runtimeCompiler: true,
  },
});
