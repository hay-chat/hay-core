<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Review AI Message</DialogTitle>
        <DialogDescription>
          Review and optionally edit the message before sending to the customer.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Original Content (if edited) -->
        <div v-if="isEdited" class="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md">
          <p class="text-xs font-medium text-neutral-muted mb-1">Original AI Response:</p>
          <p class="text-sm">{{ originalContent }}</p>
        </div>

        <!-- Editable Content -->
        <div>
          <Label for="message-content">Message Content</Label>
          <Textarea
            id="message-content"
            v-model="editedContent"
            rows="8"
            class="w-full mt-1"
            placeholder="Edit message content..."
          />
          <p class="text-xs text-neutral-muted mt-1">
            {{ editedContent.length }} characters
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between pt-4 border-t">
          <div class="flex items-center gap-2">
            <Button
              variant="destructive"
              @click="handleBlock"
              :disabled="loading"
            >
              <Ban class="h-4 w-4 mr-2" />
              Block Message
            </Button>
          </div>

          <div class="flex items-center gap-2">
            <Button variant="outline" @click="handleCancel" :disabled="loading">
              Cancel
            </Button>
            <Button @click="handleApprove" :disabled="loading || !editedContent.trim()">
              <Check class="h-4 w-4 mr-2" />
              {{ isEdited ? "Approve & Send Edited" : "Approve & Send" }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Check, Ban } from "lucide-vue-next";
import { useMessageApproval } from "@/composables/useMessageApproval";

const props = defineProps<{
  open: boolean;
  messageId: string;
  originalContent: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  approved: [messageId: string, editedContent?: string];
  blocked: [messageId: string];
}>();

const { approveMessage, blockMessage, loading } = useMessageApproval();

const editedContent = ref("");
const isEdited = computed(() => editedContent.value !== props.originalContent);

// Reset content when dialog opens
watch(() => props.open, (newValue) => {
  if (newValue) {
    editedContent.value = props.originalContent;
  }
});

const handleApprove = async () => {
  try {
    const content = isEdited.value ? editedContent.value : undefined;
    await approveMessage(props.messageId, content);
    emit("approved", props.messageId, content);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to approve message:", error);
  }
};

const handleBlock = async () => {
  try {
    await blockMessage(props.messageId, "Blocked by reviewer");
    emit("blocked", props.messageId);
    emit("update:open", false);
  } catch (error) {
    console.error("Failed to block message:", error);
  }
};

const handleCancel = () => {
  emit("update:open", false);
};
</script>
