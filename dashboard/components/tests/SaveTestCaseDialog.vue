<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ $t("tests.save.title") }}</DialogTitle>
        <DialogDescription>{{ $t("tests.save.description") }}</DialogDescription>
      </DialogHeader>
      <div class="space-y-4">
        <Input v-model="title" :label="$t('tests.save.name')" />
        <Input
          v-model="expectedOutcome"
          type="textarea"
          rows="3"
          :label="$t('tests.save.expectedOutcome')"
          :placeholder="$t('tests.save.expectedOutcomePlaceholder')"
        />
        <Input
          v-model="handoff"
          type="select"
          :label="$t('tests.save.handoff')"
          :options="handoffOptions"
        />
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ $t("common.cancel") }}
        </Button>
        <Button :loading="saving" @click="save">{{ $t("tests.save.submit") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Hay } from "@/utils/api";
import { useToast } from "@/composables/useToast";

/**
 * "Save as test case" (D7-12): from a test result, an AI reply in a
 * conversation (approval edits/blocks and feedback decide what a good answer
 * is).
 */
type TestCaseTarget = { kind: "runItem"; id: string } | { kind: "message"; id: string };

const props = defineProps<{ open: boolean; target: TestCaseTarget | null }>();
const emit = defineEmits<{ "update:open": [value: boolean]; saved: [] }>();

const { t } = useI18n();
const toast = useToast();

const title = ref("");
const expectedOutcome = ref("");
const handoff = ref<"either" | "must" | "mustNot">("either");
const saving = ref(false);

const handoffOptions = computed(() => [
  { value: "either", label: t("tests.save.handoffEither") },
  { value: "must", label: t("tests.save.handoffMust") },
  { value: "mustNot", label: t("tests.save.handoffMustNot") },
]);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = "";
    expectedOutcome.value = "";
    handoff.value = "either";
  },
);

async function save() {
  if (!props.target) return;
  saving.value = true;
  const overrides = {
    title: title.value.trim() || undefined,
    expectedOutcome: expectedOutcome.value.trim() || undefined,
    expectHandoff: handoff.value === "either" ? undefined : handoff.value === "must",
  };
  try {
    if (props.target.kind === "runItem") {
      await Hay.testCases.createFromRunItem.mutate({ itemId: props.target.id, ...overrides });
    } else {
      await Hay.testCases.createFromMessage.mutate({ messageId: props.target.id, ...overrides });
    }
    toast.success(t("tests.save.saved"));
    emit("saved");
    emit("update:open", false);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}
</script>
