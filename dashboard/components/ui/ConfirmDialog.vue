<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>
      <slot />
      <DialogFooter>
        <Button variant="outline" :disabled="loading" @click="handleCancel"> Cancel </Button>
        <Button
          :variant="destructive ? 'destructive' : 'default'"
          :loading="loading"
          @click="handleConfirm"
        >
          {{ confirmText }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  destructive?: boolean;
  /**
   * When provided, shows a loading spinner on the confirm button and prevents
   * the dialog from auto-closing on confirm. The parent is responsible for
   * closing the dialog by setting `open` to `false`.
   */
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  confirmText: "Confirm",
  destructive: false,
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const isOpen = computed({
  get() {
    return props.open;
  },
  set(value) {
    // Prevent closing while loading
    if (props.loading && !value) return;
    emit("update:open", value);
  },
});

const handleConfirm = () => {
  emit("confirm");
  // Only auto-close if the parent is NOT using the loading prop.
  // When loading is undefined (not bound), auto-close for backward compat.
  if (props.loading === undefined) {
    isOpen.value = false;
  }
};

const handleCancel = () => {
  emit("cancel");
  isOpen.value = false;
};
</script>
