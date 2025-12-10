<template>
  <div class="mention-menu">
    <div v-if="items.length === 0" class="mention-item mention-no-results">
      <div class="mention-item-icon">🔍</div>
      <div class="mention-item-content">
        <div class="mention-item-name">No items found</div>
        <div class="mention-item-meta">Try a different search term</div>
      </div>
    </div>
    <template v-else>
      <button
        v-for="(item, index) in items"
        :key="item.id"
        :ref="setItemRef(index)"
        type="button"
        class="mention-item"
        :class="{
          active: index === selectedIndex,
          'mention-item-action': item.type === 'action',
          'mention-item-document': item.type === 'document',
        }"
        @click="selectItem(index)"
        @mouseenter="selectedIndex = index"
      >
        <div class="mention-item-icon">
          <img
            v-if="item.type === 'action' && item.pluginId"
            :src="`${apiBaseUrl}/plugins/thumbnails/${encodeURIComponent(item.pluginId)}`"
            :alt="item.label"
            class="mention-plugin-thumbnail"
          />
          <span v-else>
            {{ item.type === "action" ? "⚡" : "📄" }}
          </span>
        </div>
        <div class="mention-item-content">
          <div class="mention-item-name">{{ item.label }}</div>
          <div v-if="item.meta" class="mention-item-meta">
            {{ item.meta }}
          </div>
        </div>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { ComponentPublicInstance } from "vue";
import type { MentionItem } from "./MentionExtension";
import { useDomain } from "@/composables/useDomain";

interface Props {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

const props = defineProps<Props>();

// Get API URL
const { getApiUrl } = useDomain();
const apiBaseUrl = getApiUrl();

const selectedIndex = ref(0);
const itemRefs = ref<(HTMLElement | null)[]>([]);

const setItemRef = (index: number) => (el: Element | ComponentPublicInstance | null) => {
  if (el) {
    itemRefs.value[index] = el as HTMLElement;
  }
};

const scrollToSelected = () => {
  nextTick(() => {
    const selectedElement = itemRefs.value[selectedIndex.value];
    if (selectedElement) {
      selectedElement.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  });
};

// Watch items to reset selection when they change
watch(
  () => props.items,
  () => {
    selectedIndex.value = 0;
    itemRefs.value = [];
  },
);

// Watch selectedIndex to scroll to the selected item
watch(selectedIndex, () => {
  scrollToSelected();
});

const selectItem = (index: number) => {
  const item = props.items[index];
  if (item) {
    // Add type and pluginId attributes to the command
    props.command({
      id: item.id,
      label: item.label,
      type: item.type,
      pluginId: item.pluginId,
    } as any);
  }
};

const onKeyDown = ({ event }: { event: KeyboardEvent }) => {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value =
      (selectedIndex.value + props.items.length - 1) % props.items.length;
    return true;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length;
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    selectItem(selectedIndex.value);
    return true;
  }

  return false;
};

// Expose method for parent component
defineExpose({
  onKeyDown,
});
</script>

<style scoped>
/* Styles are inherited from InstructionsTiptap.vue global styles */
</style>
