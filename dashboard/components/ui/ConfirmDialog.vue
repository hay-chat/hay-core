<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="handleCancel"> Cancel </Button>
        <Button :variant="destructive ? 'destructive' : 'default'" @click="handleConfirm">
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
    emit("update:open", value);
  },
});

const handleConfirm = () => {
  emit("confirm");
  isOpen.value = false;
};

const handleCancel = () => {
  emit("cancel");
  isOpen.value = false;
};
</script>
