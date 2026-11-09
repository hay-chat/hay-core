<template>
  <Page :title="$t('customers.title')" :description="$t('customers.description')" width="max">
    <template #header>
      <RefreshIndicator :active="refreshing" />
      <Button variant="outline" size="sm" :loading="loading" @click="reload">
        <RefreshCcw class="h-4 w-4 mr-2" />
        {{ $t("customers.refresh") }}
      </Button>
    </template>

    <Card>
      <CardContent class="p-4 space-y-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex-1 min-w-[220px]">
            <Input
              v-model="query"
              type="search"
              :label="$t('customers.search.label')"
              :placeholder="$t('customers.search.placeholder')"
              :icon-start="Search"
              @keyup.enter="reload"
            />
          </div>
          <Button :loading="loading" @click="reload">
            {{ $t("customers.search.apply") }}
          </Button>
        </div>
        <div class="text-sm text-neutral-muted">
          <template v-if="customers.data.value">{{ $t("customers.summary", { total }) }}</template>
          <template v-else>&nbsp;</template>
        </div>
      </CardContent>
    </Card>

    <CustomerMergeSuggestions class="mt-4" @merged="reload" />

    <Card class="mt-4">
      <CardContent class="p-0">
        <div v-if="loading" class="py-12 text-center">
          <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted mx-auto" />
        </div>

        <div v-else-if="rows.length === 0" class="py-12 text-center">
          <Users class="h-8 w-8 text-neutral-muted mx-auto mb-3" />
          <p class="font-medium">{{ $t("customers.empty.title") }}</p>
          <p class="text-sm text-neutral-muted">{{ $t("customers.empty.description") }}</p>
        </div>

        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>{{ $t("customers.columns.customer") }}</TableHead>
              <TableHead>{{ $t("customers.columns.channels") }}</TableHead>
              <TableHead>{{ $t("customers.columns.email") }}</TableHead>
              <TableHead>{{ $t("customers.columns.phone") }}</TableHead>
              <TableHead>{{ $t("customers.columns.created") }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="c in rows"
              :key="c.id"
              class="cursor-pointer"
              :class="{ 'data-settle': isNewRow(c.id) }"
              @click="viewCustomer(c.id)"
            >
              <TableCell>
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <img
                      v-if="avatarFor(c)"
                      :src="avatarFor(c) || undefined"
                      :alt="getCustomerDisplayName(c)"
                      class="w-full h-full object-cover"
                    />
                    <span v-else class="text-xs font-medium text-primary">{{
                      getCustomerInitial(c)
                    }}</span>
                  </div>
                  <div class="min-w-0">
                    <div class="font-medium truncate">{{ getCustomerDisplayName(c) }}</div>
                    <div class="text-xs text-neutral-muted truncate font-mono">
                      {{ c.external_id }}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div class="flex items-center gap-1.5">
                  <component
                    :is="getChannelIcon(ch)"
                    v-for="ch in channelsFor(c)"
                    :key="ch"
                    class="h-4 w-4 text-neutral-muted"
                    :title="getChannelLabel(ch)"
                  />
                  <span v-if="channelsFor(c).length === 0" class="text-neutral-muted">—</span>
                </div>
              </TableCell>
              <TableCell>{{ c.email || "—" }}</TableCell>
              <TableCell>{{ c.phone || "—" }}</TableCell>
              <TableCell>{{ formatDateTime(c.created_at) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div
          v-if="!loading && totalPages > 1"
          class="flex items-center justify-between p-4 border-t"
        >
          <span class="text-sm text-neutral-muted">
            {{ $t("customers.pagination", { page, totalPages }) }}
          </span>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="page <= 1" @click="goToPage(page - 1)">
              <ChevronLeft class="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="page >= totalPages"
              @click="goToPage(page + 1)"
            >
              <ChevronRight class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </Page>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronLeft, ChevronRight, RefreshCcw, Search, Users } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import {
  getCustomerDisplayName,
  getCustomerInitial,
  getCustomerChannelInfo,
} from "@/utils/customer";
import { getChannelIcon, getChannelLabel } from "@/utils/channel";

type CustomerRow = RouterOutputs["customers"]["list"]["items"][number];

const router = useRouter();
const { formatDateTime } = useOrgDateTime();

const PAGE_SIZE = 20;
const page = ref(1);
const query = ref("");
// What the query uses: applied on Enter or the search button, not while typing.
const appliedQuery = ref("");

const customers = useCachedQuery(
  () => ["customers", "list", { page: page.value, search: appliedQuery.value }] as const,
  ([, , params]) =>
    Hay.customers.list.query({
      pagination: { page: params.page, limit: PAGE_SIZE },
      search: params.search ? { query: params.search } : undefined,
      sorting: { orderBy: "created_at", orderDirection: "desc" },
    }),
);
const { loading, refreshing } = customers;
const rows = computed<CustomerRow[]>(() => customers.data.value?.items ?? []);
const total = computed(() => customers.data.value?.pagination.total ?? 0);
const totalPages = computed(() => customers.data.value?.pagination.totalPages ?? 1);
const isNewRow = useNewRows(() => customers.data.value?.items, customers.keyHash);

// "_"-prefixed keys are Hay.chat bookkeeping (e.g. merged identities), not channels.
const channelsFor = (c: CustomerRow): string[] =>
  c.external_metadata ? Object.keys(c.external_metadata).filter((k) => !k.startsWith("_")) : [];

const avatarFor = (c: CustomerRow): string | null => {
  for (const ch of channelsFor(c)) {
    const info = getCustomerChannelInfo(c, ch);
    if (info.avatarUrl) return info.avatarUrl;
  }
  return null;
};

const viewCustomer = (id: string) => {
  router.push(`/customers/${id}`);
};

const reload = () => {
  page.value = 1;
  appliedQuery.value = query.value;
  void customers.refresh();
};

const goToPage = (p: number) => {
  page.value = p;
};
</script>
