<template>
  <div class="slash-command-menu">
    <!-- Submenu for actions -->
    <template v-if="showSubmenu === 'action'">
      <button
        type="button"
        class="slash-command-item slash-command-back"
        @click="showSubmenu = null"
      >
        <div class="slash-command-icon">←</div>
        <div class="slash-command-content">
          <div class="slash-command-title">Back</div>
        </div>
      </button>
      <button
        v-for="(tool, index) in mcpTools"
        :key="tool.id"
        :ref="(el) => setItemRef(el, index)"
        type="button"
        class="slash-command-item"
        :class="{ active: index === selectedIndex }"
        @click="insertAction(tool)"
        @mouseenter="selectedIndex = index"
      >
        <div class="slash-command-icon">
          <img
            v-if="tool.pluginId"
            :src="`http://localhost:3001/plugins/thumbnails/${tool.pluginId}`"
            :alt="tool.label"
            class="slash-command-thumbnail"
          />
          <span v-else>⚡</span>
        </div>
        <div class="slash-command-content">
          <div class="slash-command-title">{{ tool.label }}</div>
        </div>
      </button>
    </template>

    <!-- Submenu for documents -->
    <template v-else-if="showSubmenu === 'document'">
      <button
        type="button"
        class="slash-command-item slash-command-back"
        @click="showSubmenu = null"
      >
        <div class="slash-command-icon">←</div>
        <div class="slash-command-content">
          <div class="slash-command-title">Back</div>
        </div>
      </button>
      <button
        v-for="(doc, index) in documents"
        :key="doc.id"
        :ref="(el) => setItemRef(el, index)"
        type="button"
        class="slash-command-item"
        :class="{ active: index === selectedIndex }"
        @click="insertDocument(doc)"
        @mouseenter="selectedIndex = index"
      >
        <div class="slash-command-icon">📄</div>
        <div class="slash-command-content">
          <div class="slash-command-title">{{ doc.name }}</div>
        </div>
      </button>
    </template>

    <!-- Main menu -->
    <template v-else>
      <div v-if="items.length === 0" class="slash-command-item slash-command-no-results">
        <div class="slash-command-icon">🔍</div>
        <div class="slash-command-content">
          <div class="slash-command-title">No commands found</div>
        </div>
      </div>
      <template v-else>
        <button
          v-for="(item, index) in items"
          :key="item.title"
          :ref="(el) => setItemRef(el, index)"
          type="button"
          class="slash-command-item"
          :class="{ active: index === selectedIndex }"
          @click="selectItem(index)"
          @mouseenter="selectedIndex = index"
        >
          <div class="slash-command-icon">
            <component :is="getLucideIcon(item.icon)" :size="18" />
          </div>
          <div class="slash-command-content">
            <div class="slash-command-title">{{ item.title }}</div>
          </div>
        </button>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { CommandItem } from "./SlashCommand";
import type { MCPTool, DocumentItem } from "./MentionExtension";
import { Type, Heading1, Heading2, List, ListOrdered, Zap, Book } from "lucide-vue-next";

// Map icon names to Lucide components
const iconMap: Record<string, any> = {
  type: Type,
  "heading-1": Heading1,
  "heading-2": Heading2,
  list: List,
  "list-ordered": ListOrdered,
  zap: Zap,
  book: Book,
};

const getLucideIcon = (iconName: string) => {
  return iconMap[iconName] || Type;
};

interface Props {
  items: CommandItem[];
  command: (item: CommandItem) => void;
  mcpTools: MCPTool[];
  documents: DocumentItem[];
}

const props = defineProps<Props>();

const selectedIndex = ref(0);
const showSubmenu = ref<"action" | "document" | null>(null);
const itemRefs = ref<(HTMLElement | null)[]>([]);

const setItemRef = (el: any, index: number) => {
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

// Watch submenu to reset selection when it changes
watch(showSubmenu, () => {
  selectedIndex.value = 0;
  itemRefs.value = [];
});

// Watch selectedIndex to scroll to the selected item
watch(selectedIndex, () => {
  scrollToSelected();
});

const selectItem = (index: number) => {
  const item = props.items[index];
  if (item) {
    // If it's Action or Document type, show submenu instead of executing command
    if (item.type === "action") {
      showSubmenu.value = "action";
    } else if (item.type === "document") {
      showSubmenu.value = "document";
    } else {
      props.command(item);
    }
  }
};

const insertAction = (tool: MCPTool) => {
  // Create a command item for the action
  const commandItem: CommandItem = {
    title: tool.label,
    description: tool.pluginName,
    icon: tool.pluginId,
    type: "action",
    pluginId: tool.pluginId,
    id: tool.id,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "mention",
          attrs: {
            id: tool.id,
            label: tool.label,
            type: "action",
            pluginId: tool.pluginId,
          },
        })
        .insertContent(" ")
        .run();
    },
  };
  props.command(commandItem);
};

const insertDocument = (doc: DocumentItem) => {
  // Create a command item for the document
  const commandItem: CommandItem = {
    title: doc.name,
    description: doc.type,
    icon: "📄",
    type: "document",
    id: doc.id,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "mention",
          attrs: {
            id: doc.id,
            label: doc.name,
            type: "document",
          },
        })
        .insertContent(" ")
        .run();
    },
  };
  props.command(commandItem);
};

const onKeyDown = ({ event }: { event: KeyboardEvent }) => {
  // Handle Escape or Backspace to go back from submenu
  if ((event.key === "Escape" || event.key === "Backspace") && showSubmenu.value) {
    event.preventDefault();
    showSubmenu.value = null;
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const totalItems = showSubmenu.value === "action"
      ? props.mcpTools.length
      : showSubmenu.value === "document"
      ? props.documents.length
      : props.items.length;
    selectedIndex.value = (selectedIndex.value + totalItems - 1) % totalItems;
    return true;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const totalItems = showSubmenu.value === "action"
      ? props.mcpTools.length
      : showSubmenu.value === "document"
      ? props.documents.length
      : props.items.length;
    selectedIndex.value = (selectedIndex.value + 1) % totalItems;
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();

    // Handle submenu selection
    if (showSubmenu.value === "action") {
      const tool = props.mcpTools[selectedIndex.value];
      if (tool) {
        insertAction(tool);
      }
    } else if (showSubmenu.value === "document") {
      const doc = props.documents[selectedIndex.value];
      if (doc) {
        insertDocument(doc);
      }
    } else {
      selectItem(selectedIndex.value);
    }
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
/* Styles defined in InstructionsTiptap.vue */
</style>
