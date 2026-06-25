<template>
  <Page :title="displayName" :description="$t('customers.profile.description')">
    <template #header>
      <Button variant="ghost" size="sm" @click="goBack">
        <ArrowLeft class="h-4 w-4 mr-2" />
        {{ $t("customers.profile.back") }}
      </Button>
    </template>

    <div v-if="loading" class="py-12 text-center">
      <RefreshCcw class="h-6 w-6 animate-spin text-neutral-muted mx-auto" />
    </div>

    <template v-else-if="customer">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Profile / contact -->
        <Card class="lg:col-span-1">
          <CardContent class="p-6 space-y-4">
            <div class="flex items-center gap-3">
              <div
                class="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
              >
                <img
                  v-if="avatarUrl"
                  :src="avatarUrl"
                  :alt="displayName"
                  class="w-full h-full object-cover"
                />
                <span v-else class="text-lg font-semibold text-primary">{{ initial }}</span>
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-lg truncate">{{ displayName }}</div>
                <div v-if="primaryHandle" class="text-sm text-neutral-muted truncate">
                  {{ primaryHandle }}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="ch in channels" :key="ch" variant="secondary" class="gap-1">
                <component :is="getChannelIcon(ch)" class="h-3 w-3" />
                {{ getChannelLabel(ch) }}
              </Badge>
            </div>

            <div class="space-y-2 text-sm border-t pt-4">
              <div class="flex justify-between gap-2">
                <span class="text-neutral-muted">{{ $t("customers.fields.email") }}</span>
                <span class="truncate">{{ customer.email || "—" }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-neutral-muted">{{ $t("customers.fields.phone") }}</span>
                <span class="truncate">{{ customer.phone || "—" }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-neutral-muted">{{ $t("customers.fields.externalId") }}</span>
                <span class="truncate font-mono text-xs">{{ customer.external_id || "—" }}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-neutral-muted">{{ $t("customers.fields.created") }}</span>
                <span>{{ formatDateTime(customer.created_at) }}</span>
              </div>
            </div>

            <div v-if="customer.notes" class="border-t pt-4">
              <div class="text-sm text-neutral-muted mb-1">{{ $t("customers.fields.notes") }}</div>
              <p class="text-sm whitespace-pre-wrap">{{ customer.notes }}</p>
            </div>
          </CardContent>
        </Card>

        <!-- Conversation history -->
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle class="text-base">{{ $t("customers.conversations.title") }}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              v-if="conversations.length === 0"
              class="text-sm text-neutral-muted py-6 text-center"
            >
              {{ $t("customers.conversations.none") }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="conv in conversations"
                :key="conv.id"
                class="flex items-center gap-3 p-3 border rounded-md hover:bg-background-secondary cursor-pointer"
                @click="viewConversation(conv.id)"
              >
                <component
                  :is="getChannelIcon(conv.channel)"
                  class="h-4 w-4 text-neutral-muted flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium truncate">
                    {{ conv.title || $t("conversations.untitled") }}
                  </div>
                  <div class="text-xs text-neutral-muted">
                    {{ getChannelLabel(conv.channel) }} •
                    {{ formatDateTime(conv.lastMessageAt || conv.createdAt) }} •
                    {{ $t("customers.conversations.messageCount", { count: conv.messageCount }) }}
                  </div>
                </div>
                <Badge variant="outline">{{ conv.status }}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>

    <div v-else class="py-12 text-center text-neutral-muted">
      {{ $t("customers.profile.notFound") }}
    </div>
  </Page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ArrowLeft, RefreshCcw } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import {
  getCustomerDisplayName,
  getCustomerInitial,
  getCustomerChannelInfo,
} from "@/utils/customer";
import { getChannelIcon, getChannelLabel } from "@/utils/channel";

type CustomerDetail = RouterOutputs["customers"]["get"];
type CustomerConversation = RouterOutputs["conversations"]["byCustomer"][number];

const route = useRoute();
const router = useRouter();
const { formatDateTime } = useOrgDateTime();

const customerId = route.params["id"] as string;
const customer = ref<CustomerDetail | null>(null);
const conversations = ref<CustomerConversation[]>([]);
const loading = ref(true);

const channels = computed(() =>
  customer.value?.external_metadata ? Object.keys(customer.value.external_metadata) : [],
);

const displayName = computed(() => getCustomerDisplayName(customer.value, channels.value[0]));
const initial = computed(() => getCustomerInitial(customer.value, channels.value[0]));

const primaryHandle = computed(() => {
  for (const ch of channels.value) {
    const info = getCustomerChannelInfo(customer.value, ch);
    if (info.handle) return `@${info.handle}`;
  }
  return null;
});

const avatarUrl = computed(() => {
  for (const ch of channels.value) {
    const info = getCustomerChannelInfo(customer.value, ch);
    if (info.avatarUrl) return info.avatarUrl;
  }
  return null;
});

const goBack = () => router.push("/customers");
const viewConversation = (id: string) => router.push(`/conversations/${id}`);

onMounted(async () => {
  loading.value = true;
  try {
    const [c, convs] = await Promise.all([
      Hay.customers.get.query({ id: customerId }),
      Hay.conversations.byCustomer.query({ customerId }),
    ]);
    customer.value = c;
    conversations.value = convs;
  } catch {
    customer.value = null;
  } finally {
    loading.value = false;
  }
});
</script>
