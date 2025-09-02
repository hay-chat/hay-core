module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2020: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: ['./tsconfig.json', './dashboard/tsconfig.json', './server/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  rules: {
    // TypeScript rules
    '@typescript-eslint/no-unused-vars': ['warn', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    
    // General rules
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'prefer-const': 'warn',
    'no-constant-condition': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
  overrides: [
    // Vue files configuration
    {
      files: ['dashboard/**/*.vue'],
      parser: 'vue-eslint-parser',
      parserOptions: {
        parser: '@typescript-eslint/parser',
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      extends: [
        'plugin:vue/vue3-recommended',
        'plugin:@typescript-eslint/recommended',
      ],
      plugins: ['vue'],
      rules: {
        'vue/multi-word-component-names': 'off',
        'vue/no-v-html': 'off',
        'vue/require-default-prop': 'off',
        'vue/no-multiple-template-root': 'off',
        'vue/no-setup-props-destructure': 'off',
        'vue/component-tags-order': ['error', {
          order: ['template', 'script', 'style']
        }],
        'vue/block-lang': ['error', {
          script: { lang: 'ts' }
        }],
        'vue/component-api-style': ['error', ['script-setup']],
        'vue/custom-event-name-casing': ['error', 'camelCase'],
      },
      globals: {
        // Vue Composition API
        ref: 'readonly',
        reactive: 'readonly',
        computed: 'readonly',
        watch: 'readonly',
        watchEffect: 'readonly',
        watchPostEffect: 'readonly',
        watchSyncEffect: 'readonly',
        nextTick: 'readonly',
        onMounted: 'readonly',
        onUpdated: 'readonly',
        onUnmounted: 'readonly',
        onBeforeMount: 'readonly',
        onBeforeUpdate: 'readonly',
        onBeforeUnmount: 'readonly',
        onActivated: 'readonly',
        onDeactivated: 'readonly',
        onErrorCaptured: 'readonly',
        onRenderTracked: 'readonly',
        onRenderTriggered: 'readonly',
        onServerPrefetch: 'readonly',
        // Vue Macros
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        defineModel: 'readonly',
        defineSlots: 'readonly',
        defineOptions: 'readonly',
        withDefaults: 'readonly',
        // Vue Reactivity
        toRef: 'readonly',
        toRefs: 'readonly',
        toRaw: 'readonly',
        toValue: 'readonly',
        readonly: 'readonly',
        shallowRef: 'readonly',
        shallowReactive: 'readonly',
        shallowReadonly: 'readonly',
        markRaw: 'readonly',
        customRef: 'readonly',
        triggerRef: 'readonly',
        isRef: 'readonly',
        isReactive: 'readonly',
        isReadonly: 'readonly',
        isProxy: 'readonly',
        isShallow: 'readonly',
        unref: 'readonly',
        proxyRefs: 'readonly',
        // Vue Utilities
        provide: 'readonly',
        inject: 'readonly',
        h: 'readonly',
        resolveComponent: 'readonly',
        resolveDirective: 'readonly',
        withDirectives: 'readonly',
        // Nuxt 3 auto-imports
        useRoute: 'readonly',
        useRouter: 'readonly',
        useAsyncData: 'readonly',
        useFetch: 'readonly',
        useHead: 'readonly',
        useLazyAsyncData: 'readonly',
        useLazyFetch: 'readonly',
        useNuxtApp: 'readonly',
        useNuxtData: 'readonly',
        useRuntimeConfig: 'readonly',
        useState: 'readonly',
        useCookie: 'readonly',
        useRequestEvent: 'readonly',
        useRequestHeaders: 'readonly',
        useRequestURL: 'readonly',
        useRequestFetch: 'readonly',
        navigateTo: 'readonly',
        abortNavigation: 'readonly',
        defineNuxtComponent: 'readonly',
        defineNuxtPlugin: 'readonly',
        defineNuxtRouteMiddleware: 'readonly',
        definePageMeta: 'readonly',
        refreshNuxtData: 'readonly',
        clearNuxtData: 'readonly',
        clearNuxtState: 'readonly',
        createError: 'readonly',
        showError: 'readonly',
        clearError: 'readonly',
        isNuxtError: 'readonly',
        useError: 'readonly',
        useSeoMeta: 'readonly',
        defineNuxtLink: 'readonly',
        // Global utilities
        $fetch: 'readonly',
      },
    },
    // TypeScript files in dashboard
    {
      files: ['dashboard/**/*.ts', 'dashboard/**/*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    // Server TypeScript files
    {
      files: ['server/**/*.ts', 'server/**/*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-console': 'off', // Server can use console for logging
      },
    },
    // Configuration files
    {
      files: ['*.config.js', '*.config.ts', '.eslintrc.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    // Test files
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    '.nuxt',
    '.output',
    'coverage',
    '*.min.js',
    'dashboard/.nuxt/**',
    'dashboard/.output/**',
    'server/dist/**',
    'plugins/*/dist/**',
    '*.d.ts',
    'tsconfig.tsbuildinfo',
  ],
};