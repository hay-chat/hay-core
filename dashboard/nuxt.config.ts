// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from "nuxt/config";
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  compatibilityDate: "2025-09-19",
  ssr: false,

  // Dev-only tooling: never part of a production build.
  $development: {
    devtools: { enabled: true },
    vite: {
      server: {
        fs: {
          // Allow serving files from one level up to access plugins directory
          allow: [".."],
        },
      },
    },
  },

  // Server configuration for local development
  devServer: {
    port: 3000,
  },

  // Runtime config for domain handling
  // In development, uses separate origin (CORS). In production, uses same-origin via App Platform routing.
  runtimeConfig: {
    public: {
      // PostHog telemetry — only enabled when a project API key is provided
      posthogKey: process.env["POSTHOG_KEY"] || "",
      posthogHost: process.env["POSTHOG_HOST"] || "https://eu.i.posthog.com",
      // Organization (on this deployment) whose assistant answers questions about Hay in the
      // dashboard. Unset means no support widget.
      supportWidgetOrgId: process.env["SUPPORT_WIDGET_ORG_ID"] || "",
      baseDomain:
        process.env["BASE_DOMAIN"] ||
        (process.env["NODE_ENV"] === "development" ? "localhost:3000" : ""),
      apiDomain:
        process.env["API_DOMAIN"] ||
        (process.env["NODE_ENV"] === "development" ? "localhost:3001" : ""),
      useSSL: process.env["USE_SSL"] === "true" || process.env["NODE_ENV"] === "production",
      apiBaseUrl:
        process.env["API_BASE_URL"] ||
        (() => {
          const apiDomain =
            process.env["API_DOMAIN"] ||
            (process.env["NODE_ENV"] === "development" ? "localhost:3001" : "");
          if (!apiDomain && process.env["NODE_ENV"] !== "development") {
            console.error("ERROR: API_DOMAIN environment variable is required in production");
            return "";
          }
          const useSSL =
            process.env["USE_SSL"] === "true" || process.env["NODE_ENV"] === "production";
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
  modules: ["@nuxtjs/tailwindcss", "@pinia/nuxt", "@vueuse/nuxt", "@nuxtjs/i18n"],

  // Internationalization
  i18n: {
    locales: [
      {
        code: "en",
        name: "English",
        files: [
          "en/common.json",
          "en/auth.json",
          "en/assistant.json",
          "en/settings.json",
          "en/dashboard.json",
          "en/playbooks.json",
          "en/conversations.json",
          "en/integrations.json",
          "en/documents.json",
          "en/privacy-pages.json",
          "en/products.json",
          "en/customers.json",
          "en/access.json",
          "en/home.json",
          "en/insights.json",
          "en/actions.json",
          "en/usage.json",
          "en/analytics.json",
          "en/evidence.json",
          "en/tests.json",
          "en/setup.json",
        ],
      },
      {
        code: "pt-BR",
        name: "Português (Brasil)",
        files: [
          "pt-BR/common.json",
          "pt-BR/auth.json",
          "pt-BR/assistant.json",
          "pt-BR/settings.json",
          "pt-BR/dashboard.json",
          "pt-BR/playbooks.json",
          "pt-BR/conversations.json",
          "pt-BR/integrations.json",
          "pt-BR/documents.json",
          "pt-BR/privacy-pages.json",
          "pt-BR/products.json",
          "pt-BR/customers.json",
          "pt-BR/access.json",
          "pt-BR/home.json",
          "pt-BR/insights.json",
          "pt-BR/actions.json",
          "pt-BR/usage.json",
          "pt-BR/analytics.json",
          "pt-BR/evidence.json",
          "pt-BR/tests.json",
          "pt-BR/setup.json",
        ],
      },
    ],
    langDir: "locales",
    defaultLocale: "en",
    strategy: "no_prefix",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "hay_locale",
      alwaysRedirect: false,
      fallbackLocale: "en",
    },
    vueI18n: "./i18n.config.ts",
  },

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
      title: "Hay.chat",
      meta: [
        { charset: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "description", content: "Hay.chat dashboard" },
        { name: "robots", content: "noindex, nofollow" },
        // Installable on phones (Add to Home Screen); iOS needs this to allow Web Push
        { name: "theme-color", content: "#001df5" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-title", content: "Hay.chat" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      ],
      link: [
        { rel: "manifest", href: "/manifest.webmanifest" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
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
        // Add alias for plugins directory
        "@plugins": "../plugins",
        // Shared form schema, read from source (the server uses its CommonJS build)
        "@hay/form-schema": fileURLToPath(
          new URL("../packages/form-schema/src/index.ts", import.meta.url),
        ),
      },
    },
    server: {
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
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
    },
  },
});
