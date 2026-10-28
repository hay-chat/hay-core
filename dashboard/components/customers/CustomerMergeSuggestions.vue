<template>
  <Card v-if="suggestions.length" data-testid="customer-merge-suggestions">
    <CardHeader>
      <CardTitle class="text-base flex items-center gap-2">
        <Users class="h-4 w-4" />
        {{ $t("customers.merge.title") }}
      </CardTitle>
      <CardDescription>{{ $t("customers.merge.description") }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-2">
      <div
        v-for="s in suggestions"
        :key="`${s.customer.id}:${s.duplicate.id}`"
        class="flex flex-wrap items-center gap-3 p-3 border rounded-md"
      >
        <div class="flex-1 min-w-[220px] space-y-1">
          <div class="flex flex-wrap items-center gap-2 text-sm font-medium">
            <button type="button" class="hover:underline" @click="open(s.customer.id)">
              {{ getCustomerDisplayName(s.customer, channelsOf(s.customer)[0]) }}
            </button>
            <component
              :is="getChannelIcon(ch)"
              v-for="ch in channelsOf(s.customer)"
              :key="`a-${ch}`"
              class="h-3.5 w-3.5 text-neutral-muted"
              :title="getChannelLabel(ch)"
            />
            <span class="text-neutral-muted">↔</span>
            <button type="button" class="hover:underline" @click="open(s.duplicate.id)">
              {{ getCustomerDisplayName(s.duplicate, channelsOf(s.duplicate)[0]) }}
            </button>
            <component
              :is="getChannelIcon(ch)"
              v-for="ch in channelsOf(s.duplicate)"
              :key="`b-${ch}`"
              class="h-3.5 w-3.5 text-neutral-muted"
              :title="getChannelLabel(ch)"
            />
          </div>
          <div class="text-xs text-neutral-muted">
            {{
              s.reason === "email"
                ? $t("customers.merge.sameEmail", { value: s.value })
                : $t("customers.merge.samePhone", { value: s.value })
            }}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            :loading="busy === key(s)"
            :disabled="!!busy"
            @click="dismiss(s)"
          >
            {{ $t("customers.merge.dismiss") }}
          </Button>
          <Button size="sm" :disabled="!!busy" @click="pending = s">
            <Merge class="h-4 w-4 mr-1.5" />
            {{ $t("customers.merge.merge") }}
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>

  <Dialog :open="!!pending" @update:open="(value: boolean) => !value && (pending = null)">
    <DialogContent v-if="pending">
      <DialogHeader>
        <DialogTitle>{{ $t("customers.merge.confirmTitle") }}</DialogTitle>
        <DialogDescription>
          {{
            $t("customers.merge.confirmDescription", {
              source: nameOf(mergeSource(pending)),
              target: nameOf(mergeTarget(pending)),
            })
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" :disabled="!!busy" @click="pending = null">
          {{ $t("common.cancel") }}
        </Button>
        <Button :loading="busy === key(pending)" @click="merge(pending)">
          {{ $t("customers.merge.confirm") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { Merge, Users } from "lucide-vue-next";
import { Hay } from "@/utils/api";
import type { RouterOutputs } from "@/types/trpc";
import { getCustomerDisplayName } from "@/utils/customer";
import { getChannelIcon, getChannelLabel } from "@/utils/channel";

/**
 * Suggested customer merges (D13-13): customers sharing an email or a phone,
 * typically the same shopper on two channels. With `customerId` (a profile
 * page), only that customer's pairs, and a merge keeps that customer.
 * Otherwise a merge keeps the older customer.
 */
const props = defineProps<{ customerId?: string }>();
const emit = defineEmits<{ merged: [targetId: string] }>();

type Suggestion = RouterOutputs["customers"]["mergeSuggestions"][number];
type SuggestedCustomer = Suggestion["customer"];

const { t } = useI18n();
const toast = useToast();
const router = useRouter();

const suggestions = ref<Suggestion[]>([]);
const pending = ref<Suggestion | null>(null);
const busy = ref<string | null>(null);

const key = (s: Suggestion) => `${s.customer.id}:${s.duplicate.id}`;
/** Channel keys of external_metadata; "_"-prefixed keys are Hay.chat bookkeeping. */
const channelsOf = (c: SuggestedCustomer): string[] =>
  c.external_metadata ? Object.keys(c.external_metadata).filter((k) => !k.startsWith("_")) : [];
const nameOf = (c: SuggestedCustomer) => getCustomerDisplayName(c, channelsOf(c)[0]);
const mergeTarget = (s: Suggestion) =>
  props.customerId && s.duplicate.id === props.customerId ? s.duplicate : s.customer;
const mergeSource = (s: Suggestion) =>
  mergeTarget(s).id === s.customer.id ? s.duplicate : s.customer;

const open = (id: string) => router.push(`/customers/${id}`);

const load = async () => {
  try {
    suggestions.value = await Hay.customers.mergeSuggestions.query(
      props.customerId ? { customerId: props.customerId } : undefined,
    );
  } catch {
    suggestions.value = [];
  }
};

const merge = async (s: Suggestion) => {
  busy.value = key(s);
  const target = mergeTarget(s);
  try {
    await Hay.customers.merge.mutate({
      sourceCustomerId: mergeSource(s).id,
      targetCustomerId: target.id,
    });
    toast.success(t("customers.merge.merged"));
    pending.value = null;
    emit("merged", target.id);
    await load();
  } catch {
    toast.error(t("customers.merge.failed"));
  } finally {
    busy.value = null;
  }
};

const dismiss = async (s: Suggestion) => {
  busy.value = key(s);
  try {
    await Hay.customers.dismissMergeSuggestion.mutate({
      customerId: s.customer.id,
      otherCustomerId: s.duplicate.id,
    });
    suggestions.value = suggestions.value.filter((other) => key(other) !== key(s));
  } catch {
    toast.error(t("customers.merge.failed"));
  } finally {
    busy.value = null;
  }
};

onMounted(load);
defineExpose({ reload: load });
</script>
