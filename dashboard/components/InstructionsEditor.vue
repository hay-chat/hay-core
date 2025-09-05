<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label :for="editorId" class="text-sm font-medium">
        {{ label }}
      </label>
      <div class="text-xs text-muted-foreground">
        Press
        <kbd class="px-1.5 py-0.5 text-xs font-semibold bg-muted rounded"
          >/</kbd
        >
        to mention Actions or Documents
      </div>
    </div>
    <div
      :id="editorId"
      data-testid="instructions-editor"
      class="min-h-[200px] border rounded-md bg-background p-4 focus-within:border-primary"
      :class="{ 'border-red-500': error }"
      @slash-command="handleSlashCommand"
    >
    {{instructions}}
      <div class="instructions-list" @keydown="handleKeyDown" @keyup="handleKeyUp">
        <InstructionItem
          v-for="(instruction, index) in instructions"
          :key="instruction.id"
          v-model="instructions[index]"
          :level="0"
          :index="index"
          :mcp-tools="mcpTools"
          :documents="documents"
          @delete="deleteInstruction(index)"
          @add-sibling="addSibling(index)"
          @add-child="addChild(index)"
          @move-up="moveUp(index)"
          @move-down="moveDown(index)"
          @indent="indent(index)"
          @outdent="outdent(index)"
          @slash-command="handleSlashCommand"
          @close-slash-menu="hideMenu"
        />
      </div>
      
      <button
        v-if="instructions.length === 0"
        @click="addInstruction"
        class="w-full text-left text-muted-foreground hover:text-foreground transition-colors py-2"
      >
        {{ placeholder || "Start typing your instructions..." }}
      </button>
    </div>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="hint" class="text-sm text-muted-foreground">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import { HayApi } from "@/utils/api";
import InstructionItem from "@/components/InstructionItem.vue";
import { useComponentRegistry } from "@/composables/useComponentRegistry";

interface InstructionData {
  id: string;
  instructions: string;
  children?: InstructionData[];
}

interface Props {
  modelValue: InstructionData[];
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  label: "Instructions",
  placeholder: "Start typing your instructions...",
});

const emit = defineEmits<{
  "update:modelValue": [value: InstructionData[]];
}>();

const editorId = `editor-${Math.random().toString(36).substr(2, 9)}`;
const instructions = ref<InstructionData[]>([]);
const mcpTools = ref<any[]>([]);
const documents = ref<any[]>([]);
const { getComponent } = useComponentRegistry();
let menuEl: HTMLDivElement | null = null;
let activeIndex = 0;
let currentQuery = "";
let commandMode: "select" | "actions" | "documents" = "select";
let isInternalUpdate = false;
let activeSlashContext: { slashIndex: number; textarea: HTMLElement } | null = null;

// Global menu state - once we enter actions/documents mode, stay there until reset
let isInSubMenu = false;
let subMenuMode: "actions" | "documents" | null = null;

// Generate unique ID
const generateId = () => Math.random().toString(36).substr(2, 9);

// Initialize instructions from modelValue
const initializeInstructions = () => {
  if (Array.isArray(props.modelValue) && props.modelValue.length > 0) {
    instructions.value = JSON.parse(JSON.stringify(props.modelValue));
  } else {
    instructions.value = [{ id: generateId(), instructions: "" }];
  }
};

// Convert to the target format
const convertToTargetFormat = (): InstructionData[] => {
  return instructions.value.filter(item => item.instructions.trim() || (item.children && item.children.length > 0));
};

// Emit changes
const emitChange = () => {
  if (isInternalUpdate) return;
  const data = convertToTargetFormat();
  isInternalUpdate = true;
  emit("update:modelValue", data);
  nextTick(() => {
    isInternalUpdate = false;
  });
};

// Fetch MCP tools from the API
const fetchMCPTools = async () => {
  try {
    const tools = await HayApi.plugins.getMCPTools.query();
    mcpTools.value = tools;
  } catch (error) {
    console.error("Failed to fetch MCP tools:", error);
    mcpTools.value = [];
  }
};

// Fetch documents from the API
const fetchDocuments = async () => {
  try {
    const result = await HayApi.documents.list.query({
      pagination: { page: 1, limit: 100 },
    });

    documents.value = (result.items || [])
      .map((doc: any) => ({
        id: doc.id || "",
        name: doc.name || doc.title || "Untitled Document",
        type: doc.type || "document",
        url: doc.url || "",
      }))
      .filter((doc) => doc.id && doc.name);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    documents.value = [];
  }
};

// Instruction management functions
const addInstruction = () => {
  instructions.value.push({ id: generateId(), instructions: "" });
  emitChange();
};

const deleteInstruction = (index: number) => {
  instructions.value.splice(index, 1);
  if (instructions.value.length === 0) {
    addInstruction();
  }
  emitChange();
};

const addSibling = (index: number) => {
  instructions.value.splice(index + 1, 0, { id: generateId(), instructions: "" });
  emitChange();
};

const addChild = (index: number) => {
  if (!instructions.value[index].children) {
    instructions.value[index].children = [];
  }
  instructions.value[index].children!.push({ id: generateId(), instructions: "" });
  emitChange();
};

const moveUp = (index: number) => {
  if (index > 0) {
    [instructions.value[index], instructions.value[index - 1]] = [
      instructions.value[index - 1],
      instructions.value[index],
    ];
    emitChange();
  }
};

const moveDown = (index: number) => {
  if (index < instructions.value.length - 1) {
    [instructions.value[index], instructions.value[index + 1]] = [
      instructions.value[index + 1],
      instructions.value[index],
    ];
    emitChange();
  }
};

const indent = (index: number) => {
  if (index > 0) {
    const instruction = instructions.value.splice(index, 1)[0];
    if (!instructions.value[index - 1].children) {
      instructions.value[index - 1].children = [];
    }
    instructions.value[index - 1].children!.push(instruction);
    emitChange();
  }
};

const outdent = (index: number) => {
  // This would need more complex logic for nested items
  // For now, just implemented at the top level
};

// Highlight matching text in bold
function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text;
  
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<strong>$1</strong>');
}

// Slash command helpers
function ensureMenu() {
  if (!menuEl) {
    menuEl = document.createElement("div");
    menuEl.className = "mcp-menu";
    document.body.appendChild(menuEl);
  }
  return menuEl;
}

function showMenu(rect: DOMRect, items: any[]) {
  
  const el = ensureMenu();
  el.style.display = "block";
  el.style.position = "fixed";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 6}px`;
  el.style.zIndex = "9999";

  let html = "";

  if (commandMode === "select") {
    html = `
      <div class="mcp-item ${
        activeIndex === 0 ? "active" : ""
      }" data-type="actions">
        <div class="mcp-item-icon">⚡</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">Actions</div>
          <div class="mcp-item-meta">Insert MCP tool action</div>
        </div>
      </div>
      <div class="mcp-item ${
        activeIndex === 1 ? "active" : ""
      }" data-type="documents">
        <div class="mcp-item-icon"></div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">Documents</div>
          <div class="mcp-item-meta">Reference a document</div>
        </div>
      </div>
    `;
  } else if (commandMode === "actions") {
    html = items
      .map(
        (tool, i) => `
      <div class="mcp-item mcp-item-action ${
        i === activeIndex ? "active" : ""
      }" data-id="${tool.id}">
        <div class="mcp-item-icon">⚡</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">${highlightMatch(tool.name, currentQuery)}</div>
          <div class="mcp-item-meta">${highlightMatch(tool.label, currentQuery)} - ${highlightMatch(tool.pluginName, currentQuery)}</div>
        </div>
      </div>
    `
      )
      .join("");
  } else if (commandMode === "documents") {
    html = items
      .map((doc, i) => {
        let metaInfo = doc.type || "document";
        if (doc.url) {
          try {
            metaInfo += " • " + new URL(doc.url).hostname;
          } catch (e) {
            // Invalid URL, just show type
          }
        }
        return `
        <div class="mcp-item mcp-item-document ${
          i === activeIndex ? "active" : ""
        }" data-id="${doc.id}">
          <div class="mcp-item-icon"></div>
          <div class="mcp-item-content">
            <div class="mcp-item-name">${highlightMatch(doc.name || "Untitled", currentQuery)}</div>
            <div class="mcp-item-meta">${highlightMatch(metaInfo, currentQuery)}</div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  el.innerHTML = html;

  // Add mouse interactions
  el.querySelectorAll(".mcp-item").forEach((node, i) => {
    node.addEventListener("mouseenter", () => {
      activeIndex = i;
      showMenu(rect, items);
    });
    node.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handleItemSelection(items[i]);
    });
  });
}

function hideMenu() {
  if (menuEl) menuEl.style.display = "none";
  activeIndex = 0;
  currentQuery = "";
  commandMode = "select";
  activeSlashContext = null;
  
  // Reset global menu state
  isInSubMenu = false;
  subMenuMode = null;
  console.log(`[DEBUG] Menu hidden and state reset`);
}

function handleItemSelection(item: any) {
  if (commandMode === "select") {
    const type = activeIndex === 0 ? "actions" : "documents";
    commandMode = type as "actions" | "documents";
    activeIndex = 0;
    
    if (activeSlashContext) {
      const items = commandMode === "actions" ? filterTools(currentQuery) : filterDocuments(currentQuery);
      showMenu(activeSlashContext.textarea.getBoundingClientRect(), items);
    }
  } else if (commandMode === "actions") {
    insertAction(item);
    hideMenu();
  } else if (commandMode === "documents") {
    insertDocument(item);
    hideMenu();
  }
}

function insertAction(tool: any) {
  if (!activeSlashContext) return;
  
  // Find the corresponding RichInstructionInput component
  const editorElement = activeSlashContext.textarea;
  const richInputWrapper = editorElement.closest('.rich-instruction-input');
  if (!richInputWrapper) return;
  
  const componentId = richInputWrapper.getAttribute('data-component-id');
  if (!componentId) return;
  
  // Get the component instance from the registry
  const componentInstance = getComponent(componentId);
  if (componentInstance && componentInstance.insertReference) {
    componentInstance.insertReference('action', tool);
  }
}

function insertDocument(doc: any) {
  if (!activeSlashContext) return;
  
  // Find the corresponding RichInstructionInput component
  const editorElement = activeSlashContext.textarea;
  const richInputWrapper = editorElement.closest('.rich-instruction-input');
  if (!richInputWrapper) return;
  
  const componentId = richInputWrapper.getAttribute('data-component-id');
  if (!componentId) return;
  
  // Get the component instance from the registry
  const componentInstance = getComponent(componentId);
  if (componentInstance && componentInstance.insertReference) {
    componentInstance.insertReference('document', doc);
  }
}

function filterTools(query: string) {
  const q = query.toLowerCase();
  return mcpTools.value.filter(
    (tool) =>
      tool.name.toLowerCase().includes(q) ||
      tool.label.toLowerCase().includes(q) ||
      tool.pluginName.toLowerCase().includes(q)
  );
}

function filterDocuments(query: string) {
  const q = query.toLowerCase();
  return documents.value.filter((doc) => {
    if (!doc) return false;
    const nameMatch = doc.name && doc.name.toLowerCase().includes(q);
    const typeMatch = doc.type && doc.type.toLowerCase().includes(q);
    return nameMatch || typeMatch;
  });
}

// Handle slash command events from child components
const handleSlashCommand = (data: { query: string; slashIndex: number; textarea: HTMLElement; mode?: string }) => {
  const { query, slashIndex, textarea, mode } = data;
  
  console.log(`[DEBUG] Parent received: query="${query}", mode="${mode || 'undefined'}", isInSubMenu=${isInSubMenu}, subMenuMode=${subMenuMode}`);
  
  activeSlashContext = { slashIndex, textarea };
  currentQuery = query;
  activeIndex = 0;
  
  // Rule 1: If we receive a specific mode hint (/a or /d shortcut), switch to that mode
  if (mode === "actions") {
    commandMode = "actions";
    isInSubMenu = true;
    subMenuMode = "actions";
    console.log(`[DEBUG] Switched to actions mode via shortcut`);
  } else if (mode === "documents") {
    commandMode = "documents";
    isInSubMenu = true;
    subMenuMode = "documents";
    console.log(`[DEBUG] Switched to documents mode via shortcut`);
  } 
  // Rule 2: If we're already in a sub-menu, stay in that mode (filtering)
  else if (isInSubMenu && subMenuMode) {
    commandMode = subMenuMode;
    console.log(`[DEBUG] Staying in ${subMenuMode} mode for filtering, query="${query}"`);
  }
  // Rule 3: Default to select mode only if we're not in a sub-menu
  else {
    commandMode = "select";
    console.log(`[DEBUG] Using select mode (default)`);
  }
  
  let items: any[] = [];
  if (commandMode === "select") {
    items = [{ type: "actions" }, { type: "documents" }];
  } else if (commandMode === "actions") {
    items = filterTools(currentQuery);
  } else if (commandMode === "documents") {
    items = filterDocuments(currentQuery);
  }
  
  
  if (items.length > 0 || commandMode !== "select") {
    // Get textarea position for menu placement
    const rect = textarea.getBoundingClientRect();
    showMenu(rect, items);
  }
};

// Keyboard event handlers
function handleKeyDown(e: KeyboardEvent) {
  // Handle slash commands when menu is open
  if (menuEl && menuEl.style.display === "block") {
    let items: any[] = [];

    if (commandMode === "select") {
      items = [{ type: "actions" }, { type: "documents" }];
    } else if (commandMode === "actions") {
      items = filterTools(currentQuery);
    } else if (commandMode === "documents") {
      items = filterDocuments(currentQuery);
    }

    const maxIndex = commandMode === "select" ? 2 : items.length;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (e.key === "ArrowDown") {
        activeIndex = (activeIndex + 1) % maxIndex;
      } else {
        activeIndex = activeIndex === 0 ? maxIndex - 1 : activeIndex - 1;
      }
      
      if (activeSlashContext) {
        showMenu(activeSlashContext.textarea.getBoundingClientRect(), items);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      hideMenu();
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (items.length > 0) {
        handleItemSelection(items[activeIndex]);
      }
      return;
    }
  }
}

function handleKeyUp() {
  // This will be handled by individual instruction items
}

// Initialize the editor
const initEditor = () => {
  initializeInstructions();
  
  // Add global click listener to hide menu
  document.addEventListener("click", (e) => {
    if (menuEl && e.target instanceof Node && !menuEl.contains(e.target)) {
      hideMenu();
    }
  });
};

// Lifecycle hooks
onMounted(async () => {
  await Promise.all([fetchMCPTools(), fetchDocuments()]);
  await nextTick();
  initEditor();
});

// Watch for changes in modelValue
watch(
  () => props.modelValue,
  (newValue) => {
    if (isInternalUpdate) return;
    if (Array.isArray(newValue)) {
      instructions.value = JSON.parse(JSON.stringify(newValue));
    }
  },
  { deep: true }
);

// Watch for changes in instructions and emit
watch(
  instructions,
  () => {
    emitChange();
  },
  { deep: true }
);
</script>

<style>
/* Custom editor styles */
.instructions-list {
  outline: none;
}

.instruction-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  line-height: 1.6;
}

.instruction-content {
  flex: 1;
  min-height: 1.5rem;
  padding: 0.25rem 0;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

.instruction-content:focus {
  outline: 1px solid hsl(var(--primary));
  outline-offset: 2px;
  border-radius: 4px;
}

.instruction-number {
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  min-width: 1.5rem;
  text-align: right;
  padding-top: 0.25rem;
  user-select: none;
}

/* Keyboard shortcut badge styling */
kbd {
  background-color: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
}

/* MCP Merge Field Styles */
.mcp-merge-field {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.375rem;
  font-size: 0.875em;
  cursor: default;
  user-select: none;
  vertical-align: baseline;
  font-weight: 500;
}

/* Action tokens (purple) */
.mcp-merge-field.mcp-action {
  background: rgb(147, 51, 234, 0.1);
  border: 1px solid rgb(147, 51, 234, 0.3);
  color: #9333ea;
}

.mcp-merge-field.mcp-action:hover {
  background: rgb(147, 51, 234, 0.15);
  border-color: rgb(147, 51, 234, 0.5);
}

/* Document tokens (yellow/amber) */
.mcp-merge-field.mcp-document {
  background: rgb(245, 158, 11, 0.1);
  border: 1px solid rgb(245, 158, 11, 0.3);
  color: #d97706;
}

.mcp-item-icon {
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  height: 1em;
  width: 1em;
  color: transparent;
}
/* Action icons - applies to all action items regardless of parent */
.mcp-item-action .mcp-item-icon,
[data-type="actions"] .mcp-item-icon,
.mcp-action .mcp-item-icon {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3.99999 14.0002C3.81076 14.0008 3.62522 13.9477 3.46495 13.8471C3.30467 13.7465 3.17623 13.6025 3.09454 13.4318C3.01286 13.2611 2.98129 13.0707 3.00349 12.8828C3.0257 12.6949 3.10077 12.5171 3.21999 12.3702L13.12 2.17016C13.1943 2.08444 13.2955 2.02652 13.407 2.0059C13.5185 1.98527 13.6337 2.00318 13.7337 2.05667C13.8337 2.11016 13.9126 2.19606 13.9573 2.30027C14.0021 2.40448 14.0101 2.52081 13.98 2.63016L12.06 8.65016C12.0034 8.80169 11.9844 8.96468 12.0046 9.12517C12.0248 9.28566 12.0837 9.43884 12.1761 9.57159C12.2685 9.70434 12.3918 9.81268 12.5353 9.88732C12.6788 9.96197 12.8382 10.0007 13 10.0002H20C20.1892 9.99952 20.3748 10.0526 20.535 10.1532C20.6953 10.2538 20.8238 10.3978 20.9054 10.5685C20.9871 10.7392 21.0187 10.9296 20.9965 11.1175C20.9743 11.3054 20.8992 11.4832 20.78 11.6302L10.88 21.8302C10.8057 21.9159 10.7045 21.9738 10.593 21.9944C10.4815 22.0151 10.3663 21.9972 10.2663 21.9437C10.1663 21.8902 10.0874 21.8043 10.0427 21.7001C9.99791 21.5958 9.98991 21.4795 10.02 21.3702L11.94 15.3502C11.9966 15.1986 12.0156 15.0356 11.9954 14.8752C11.9752 14.7147 11.9163 14.5615 11.8239 14.4287C11.7315 14.296 11.6082 14.1876 11.4647 14.113C11.3212 14.0384 11.1617 13.9996 11 14.0002H3.99999Z' fill='%239333EA'/%3E%3C/svg%3E%0A");
}

/* Document icons - applies to all document items regardless of parent */
.mcp-item-document .mcp-item-icon,
[data-type="documents"] .mcp-item-icon,
.mcp-document .mcp-item-icon {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 18V6C6 5.46957 6.19754 4.96086 6.54917 4.58579C6.90081 4.21071 7.37772 4 7.875 4H17.25C17.4489 4 17.6397 4.08429 17.7803 4.23431C17.921 4.38434 18 4.58783 18 4.8V19.2C18 19.4122 17.921 19.6157 17.7803 19.7657C17.6397 19.9157 17.4489 20 17.25 20H7.875C7.37772 20 6.90081 19.7893 6.54917 19.4142C6.19754 19.0391 6 18.5304 6 18ZM6 18C6 17.4696 6.19754 16.9609 6.54917 16.5858C6.90081 16.2107 7.37772 16 7.875 16H18' stroke='%23D97706' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Crect x='7' y='5' width='11' height='11' fill='%23D97706'/%3E%3C/svg%3E%0A");
}

.mcp-merge-field.mcp-document:hover {
  background: rgb(245, 158, 11, 0.15);
  border-color: rgb(245, 158, 11, 0.5);
}

/* MCP Command Palette Menu */
.mcp-menu {
  min-width: 360px;
  max-width: 520px;
  max-height: 360px;
  overflow-y: auto;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 0.625rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15), 0 8px 16px rgba(0, 0, 0, 0.1);
  padding: 0.375rem;
  display: none;
}

.mcp-item {
  display: flex;
  align-items: center;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  border-radius: 0.375rem;
  transition: all 0.15s ease;
  margin-bottom: 0.125rem;
  gap: 0.75rem;
}

.mcp-item:last-child {
  margin-bottom: 0;
}

.mcp-item:hover,
.mcp-item.active {
  background: hsl(var(--muted));
}

.mcp-item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.3;
}

.mcp-item-name {
  font-weight: 500;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  margin-bottom: 0.125rem;
}

.mcp-item-meta {
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

/* Action items (purple theme) */
.mcp-item-action.active {
  background: rgb(147, 51, 234, 0.1);
}

.mcp-item-action:hover {
  background: rgb(147, 51, 234, 0.08);
}

/* Remove text color as icons use background images */
.mcp-item-action .mcp-item-icon {
  color: transparent;
}

/* Document items (yellow/amber theme) */
.mcp-item-document.active {
  background: rgb(245, 158, 11, 0.1);
}

.mcp-item-document:hover {
  background: rgb(245, 158, 11, 0.08);
}

/* Remove text color as icons use background images */
.mcp-item-document .mcp-item-icon {
  color: transparent;
}
</style>