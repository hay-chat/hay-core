<template>
  <Page :title="$t('products.title')" :description="$t('products.description')">
    <template #header>
      <Button variant="outline" size="sm" @click="goToMarketplace">
        <Store class="h-4 w-4 mr-2" />
        {{ $t("products.browseMarketplace") }}
      </Button>
    </template>

    <Card>
      <CardContent class="p-4 space-y-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex-1 min-w-[220px]">
            <Input
              v-model="query"
              type="search"
              :label="$t('products.search.label')"
              :placeholder="$t('products.search.placeholder')"
              :icon-start="Search"
              @keyup.enter="reload"
            />
          </div>
          <div class="w-40">
            <Input
              v-model="sourceFilter"
              type="select"
              :label="$t('products.filters.source')"
              :options="sourceOptions"
            />
          </div>
          <div class="w-44">
            <Input
              v-model="availabilityFilter"
              type="select"
              :label="$t('products.filters.availability')"
              :options="availabilityOptions"
            />
          </div>
          <Button :loading="loading" @click="reload">
            <RefreshCcw class="h-4 w-4 mr-2" />
            {{ $t("products.search.apply") }}
          </Button>
        </div>

        <div class="text-sm text-neutral-muted">
          {{
            $t("products.summary", {
              total: total,
              embeddings: stats?.embeddings.totalEmbeddings ?? 0,
            })
          }}
        </div>
      </CardContent>
    </Card>

    <Card v-if="loading && rows.length === 0" class="mt-4">
      <CardContent class="py-12 text-center">
        <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted mx-auto" />
        <p class="text-neutral-muted mt-2">{{ $t("products.loading") }}</p>
      </CardContent>
    </Card>

    <Card v-else-if="rows.length === 0" class="mt-4">
      <CardContent class="py-12 text-center">
        <Package class="h-12 w-12 text-neutral-muted mx-auto mb-4" />
        <h3 class="text-lg font-medium mb-2">{{ $t("products.empty.title") }}</h3>
        <p class="text-neutral-muted">{{ $t("products.empty.description") }}</p>
      </CardContent>
    </Card>

    <div v-else class="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <Card v-for="p in rows" :key="p.id" class="overflow-hidden">
        <div class="aspect-square bg-neutral-muted/30 flex items-center justify-center">
          <img
            v-if="p.images?.[0]?.src"
            :src="p.images[0].src"
            :alt="p.title"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <Package v-else class="h-10 w-10 text-neutral-muted" />
        </div>
        <CardContent class="p-3 space-y-1">
          <div class="text-sm font-medium line-clamp-2">{{ p.title }}</div>
          <div class="text-xs text-neutral-muted">{{ p.vendor || p.source }}</div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-sm font-semibold">
              {{ formatPriceRange(p.priceMin, p.priceMax, p.currency) }}
            </span>
            <Badge :variant="p.available ? 'default' : 'outline'" class="text-[10px]">
              {{ p.available ? $t("products.inStock") : $t("products.outOfStock") }}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>

    <div v-if="total > rows.length" class="mt-4 flex justify-center">
      <Button variant="outline" :loading="loading" @click="loadMore">
        {{ $t("products.loadMore") }}
      </Button>
    </div>
  </Page>
</template>

<script setup lang="ts">
import { Package, RefreshCcw, Search, Store } from "lucide-vue-next";
import { Hay } from "@/utils/api";

definePageMeta({ middleware: ["auth"] });

const { t } = useI18n();
const router = useRouter();

interface ProductRow {
  id: string;
  title: string;
  source: string;
  vendor?: string;
  available: boolean;
  priceMin?: string;
  priceMax?: string;
  currency?: string;
  images?: { src: string; alt?: string }[];
}

const loading = ref(false);
const rows = ref<ProductRow[]>([]);
const total = ref(0);
const stats = ref<{
  products: number;
  embeddings: { totalEmbeddings: number; totalProducts: number };
} | null>(null);

const query = ref("");
const sourceFilter = ref<string>("");
const availabilityFilter = ref<string>("");

const PAGE_SIZE = 24;
const offset = ref(0);

const sourceOptions = computed(() => [
  { label: t("products.filters.allSources"), value: "" },
  { label: "Shopify", value: "shopify" },
  { label: "WooCommerce", value: "woocommerce" },
  { label: "Magento", value: "magento" },
  { label: "Custom", value: "custom" },
  { label: "Manual", value: "manual" },
]);

const availabilityOptions = computed(() => [
  { label: t("products.filters.any"), value: "" },
  { label: t("products.inStock"), value: "in" },
  { label: t("products.outOfStock"), value: "out" },
]);

function goToMarketplace() {
  router.push("/integrations/marketplace");
}

function formatPriceRange(min?: string, max?: string, currency?: string): string {
  const fmt = (raw?: string) => {
    if (!raw) return undefined;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return undefined;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency ?? ""}`.trim();
    }
  };
  const a = fmt(min);
  const b = fmt(max);
  if (!a && !b) return "—";
  if (!b || a === b) return a ?? b ?? "—";
  return `${a} – ${b}`;
}

async function reload() {
  loading.value = true;
  offset.value = 0;
  try {
    const res = await Hay.products.list.query({
      limit: PAGE_SIZE,
      offset: 0,
      source: sourceFilter.value || undefined,
      available:
        availabilityFilter.value === "in"
          ? true
          : availabilityFilter.value === "out"
            ? false
            : undefined,
      query: query.value || undefined,
    });
    rows.value = res.rows as unknown as ProductRow[];
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  loading.value = true;
  offset.value += PAGE_SIZE;
  try {
    const res = await Hay.products.list.query({
      limit: PAGE_SIZE,
      offset: offset.value,
      source: sourceFilter.value || undefined,
      available:
        availabilityFilter.value === "in"
          ? true
          : availabilityFilter.value === "out"
            ? false
            : undefined,
      query: query.value || undefined,
    });
    rows.value = [...rows.value, ...(res.rows as unknown as ProductRow[])];
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try {
    stats.value = await Hay.products.stats.query();
  } catch {
    // Stats are nice-to-have; ignore failures.
  }
}

onMounted(async () => {
  await Promise.all([reload(), loadStats()]);
});
</script>
