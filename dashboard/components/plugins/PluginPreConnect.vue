<template>
  <!--
    What a plugin page shows before it is connected. Everything here comes from
    what the plugin declares (manifest, capabilities, setup hints, auth methods).
  -->
  <div class="space-y-7" data-testid="plugin-pre-connect">
    <nav :aria-label="$t('pluginSettings.preConnect.breadcrumb')">
      <ol class="flex flex-wrap items-center gap-2 text-sm text-neutral-muted">
        <li>
          <NuxtLink to="/integrations/marketplace" class="hover:text-foreground hover:underline">
            {{ $t("marketplace.title") }}
          </NuxtLink>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <NuxtLink
            :to="{ path: '/integrations/marketplace', query: { category: section } }"
            class="hover:text-foreground hover:underline"
          >
            {{ sectionLabel }}
          </NuxtLink>
        </li>
        <li aria-hidden="true">/</li>
        <li class="font-medium text-foreground" aria-current="page">{{ name }}</li>
      </ol>
    </nav>

    <header class="flex flex-wrap items-start gap-5 border-b border-border pb-7">
      <PluginLogo :plugin-id="plugin.id" class="h-[72px] w-[72px] rounded-2xl" />
      <div class="min-w-0 flex-1 basis-80 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-3xl font-semibold leading-tight">{{ name }}</h1>
          <Badge v-if="isCustom" variant="outline">{{ $t("marketplace.custom") }}</Badge>
        </div>
        <p v-if="summary" class="max-w-xl text-base text-neutral-muted">{{ summary }}</p>
        <ul class="flex flex-wrap gap-1.5 pt-1" :aria-label="$t('pluginSettings.preConnect.tags')">
          <li v-for="chip in chips" :key="chip">
            <Badge variant="outline">{{ chip }}</Badge>
          </li>
        </ul>
      </div>
      <div class="flex w-full flex-col gap-2 sm:w-56">
        <Button
          size="lg"
          :loading="connecting"
          data-testid="plugin-connect"
          @click="emit('connect')"
        >
          {{ $t("pluginSettings.preConnect.connect", { name }) }}
        </Button>
        <Button v-if="homepage" variant="outline" :href="homepage" target="_blank">
          {{ $t("pluginSettings.preConnect.setupGuide") }}
        </Button>
        <p class="text-center text-xs text-neutral-muted">
          {{
            signIn === "oauth"
              ? $t("pluginSettings.preConnect.noteOAuth", { name })
              : $t("pluginSettings.preConnect.note")
          }}
        </p>
      </div>
    </header>

    <div class="flex flex-wrap items-start gap-10">
      <div class="min-w-0 flex-[999] basis-[30rem] space-y-9">
        <!-- The plugin's own pre-connect UI, when it ships one -->
        <slot />

        <section
          v-if="abilities.length > 0"
          aria-labelledby="plugin-abilities"
          class="space-y-3.5"
          data-testid="plugin-capabilities"
        >
          <h2 id="plugin-abilities" class="text-xl font-semibold">
            {{ $t("pluginSettings.preConnect.abilities.title") }}
          </h2>
          <ul class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(17.5rem,100%),1fr))]">
            <li
              v-for="ability in abilities"
              :key="ability.key"
              class="rounded-xl border border-border bg-background p-4"
            >
              <p class="font-semibold">{{ ability.title }}</p>
              <p class="mt-1 text-[13px] text-neutral-muted">{{ ability.description }}</p>
            </li>
          </ul>
        </section>

        <section aria-labelledby="plugin-how" class="space-y-3.5">
          <h2 id="plugin-how" class="text-xl font-semibold">
            {{ $t("pluginSettings.preConnect.how.title") }}
          </h2>
          <ol class="space-y-3.5">
            <li v-for="(step, index) in steps" :key="step" class="flex items-start gap-3.5">
              <span
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary"
                aria-hidden="true"
              >
                {{ index + 1 }}
              </span>
              <div>
                <p class="font-semibold">
                  {{ $t(`pluginSettings.preConnect.how.steps.${step}.title`, { name }) }}
                </p>
                <p class="text-[13px] text-neutral-muted">
                  {{ $t(`pluginSettings.preConnect.how.steps.${step}.description`, { name }) }}
                </p>
              </div>
            </li>
          </ol>
        </section>
      </div>

      <aside class="min-w-0 flex-1 basis-64 space-y-5">
        <section
          aria-labelledby="plugin-details"
          class="rounded-xl border border-border bg-background p-5"
        >
          <h2 id="plugin-details" class="mb-3 font-semibold">
            {{ $t("pluginSettings.preConnect.details.title") }}
          </h2>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
            <dt class="text-neutral-muted">
              {{ $t("pluginSettings.preConnect.details.builtBy") }}
            </dt>
            <dd class="text-right">
              {{
                isCustom
                  ? $t("pluginSettings.preConnect.details.builtByCustom")
                  : $t("pluginSettings.preConnect.details.builtByHay")
              }}
            </dd>
            <dt class="text-neutral-muted">
              {{ $t("pluginSettings.preConnect.details.category") }}
            </dt>
            <dd class="text-right">{{ sectionLabel }}</dd>
            <template v-if="signIn">
              <dt class="text-neutral-muted">
                {{ $t("pluginSettings.preConnect.details.signIn") }}
              </dt>
              <dd class="text-right">
                {{ $t(`pluginSettings.preConnect.details.signInMethods.${signIn}`) }}
              </dd>
            </template>
            <dt class="text-neutral-muted">
              {{ $t("pluginSettings.preConnect.details.version") }}
            </dt>
            <dd class="text-right">{{ plugin.version }}</dd>
          </dl>
          <div
            v-if="homepage || canDelete"
            class="mt-4 flex flex-col items-start gap-2 border-t border-border pt-3.5 text-[13px]"
          >
            <a
              v-if="homepage"
              :href="homepage"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline"
            >
              {{ $t("pluginSettings.preConnect.details.documentation") }}
            </a>
            <button
              v-if="canDelete"
              type="button"
              class="rounded text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="plugin-delete"
              @click="emit('delete')"
            >
              {{ $t("pluginSettings.deletePlugin") }}
            </button>
          </div>
        </section>

        <section
          v-if="dataItems.length > 0"
          aria-labelledby="plugin-data"
          class="rounded-xl border border-border bg-background p-5"
        >
          <h2 id="plugin-data" class="mb-1 font-semibold">
            {{ $t("pluginSettings.preConnect.data.title") }}
          </h2>
          <p v-if="signIn === 'oauth'" class="mb-3 text-[13px] text-neutral-muted">
            {{ $t("pluginSettings.preConnect.data.noteOAuth", { name }) }}
          </p>
          <ul class="mt-3 space-y-2 text-[13px]">
            <li v-for="item in dataItems" :key="item">
              {{ $t(`pluginSettings.preConnect.data.items.${item}`) }}
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { capabilityTags, sectionOf } from "@/utils/marketplace";
import { describedCapabilities } from "@/utils/pluginSetup";
import type { RouterOutputs } from "@/types/trpc";

type Plugin = RouterOutputs["plugins"]["get"];

const props = defineProps<{
  plugin: Plugin;
  /** Name and one-liner in the dashboard's language. */
  name: string;
  summary: string;
  connecting: boolean;
  /** An admin looking at a plugin their organization uploaded. */
  canDelete: boolean;
}>();

const emit = defineEmits<{ connect: []; delete: [] }>();

const { t } = useI18n();

const isCustom = computed(() => props.plugin.sourceType !== "core");
const homepage = computed(() => props.plugin.manifest.homepage);

const section = computed(() => sectionOf(props.plugin.manifest));
const sectionLabel = computed(() => t(`marketplace.sections.${section.value}.label`));

const declaredCapabilities = computed<unknown>(() => props.plugin.manifest.capabilities);
const types = computed<string[]>(() => props.plugin.type ?? []);

const chips = computed(() => [
  sectionLabel.value,
  ...capabilityTags({ type: types.value, capabilities: declaredCapabilities.value }).map((tag) =>
    t(`marketplace.tags.${tag}`),
  ),
]);

// How the merchant signs in, once the plugin has told core its auth methods.
const signIn = computed<"oauth" | "apiKey" | null>(() => {
  const methods = props.plugin.metadata?.authMethods ?? [];
  if (methods.some((method) => method.type === "oauth2")) return "oauth";
  if (methods.some((method) => method.type === "apiKey")) return "apiKey";
  return null;
});

const handles = computed(() => props.plugin.manifest.setup?.handles ?? []);

// "What your agent can do": customer requests the plugin handles, then its capabilities.
const abilities = computed(() => {
  const capabilities = describedCapabilities(declaredCapabilities.value);
  if (types.value.includes("document_importer") && !capabilities.includes("documents")) {
    capabilities.push("documents");
  }
  return [
    ...handles.value.map((handle) => ({
      key: `handle-${handle}`,
      title: t(`pluginSettings.preConnect.abilities.handles.${handle}.title`),
      description: t(`pluginSettings.preConnect.abilities.handles.${handle}.description`),
    })),
    ...capabilities.map((capability) => ({
      key: `capability-${capability}`,
      title: t(`pluginSettings.capabilities.items.${capability}.title`),
      description: t(`pluginSettings.capabilities.items.${capability}.description`),
    })),
  ];
});

const hasTools = computed(
  () => Array.isArray(declaredCapabilities.value) && declaredCapabilities.value.includes("mcp"),
);

const steps = computed(() => [
  "connect",
  signIn.value === "oauth" ? "approve" : signIn.value === "apiKey" ? "details" : "setup",
  ...(hasTools.value ? ["verify"] : []),
]);

const DATA_ITEMS = [
  "messages",
  "customers",
  "orders",
  "products",
  "payments",
  "disputes",
  "bookings",
  "tickets",
  "documents",
] as const;

// "Data it works with", from the same declarations.
const dataItems = computed(() => {
  const capabilities = Array.isArray(declaredCapabilities.value) ? declaredCapabilities.value : [];
  const handled = (...names: string[]) => handles.value.some((handle) => names.includes(handle));
  const has: Record<(typeof DATA_ITEMS)[number], boolean> = {
    messages: capabilities.includes("messages"),
    customers: capabilities.includes("customers"),
    orders: handled("orders", "order_changes"),
    products: capabilities.includes("products"),
    payments: handled("refunds", "billing", "subscriptions"),
    disputes: capabilities.includes("disputes"),
    bookings: handled("bookings"),
    tickets: capabilities.includes("tickets"),
    documents: types.value.includes("document_importer"),
  };
  return DATA_ITEMS.filter((item) => has[item]);
});
</script>
