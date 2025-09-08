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
      class="instructions-editor-container"
      :class="{ 'instructions-editor-error': error }"
      @slash-command="handleSlashCommand"
    >
      <div
        class="instructions-list"
        @keydown="handleKeyDown"
        @keyup="handleKeyUp"
        @click="handleListClick"
      >
        <InstructionItem
          v-for="(instruction, index) in instructions"
          :key="instruction.id"
          v-model="instructions[index]"
          :level="instruction.level || 0"
          :index="index"
          :hierarchical-number="getHierarchicalNumber(index)"
          :mcp-tools="mcpTools"
          :documents="documents"
          @delete="deleteInstruction(index)"
          @add-sibling="addSibling(index)"
          @add-child="addChild(index)"
          @move-up="moveUp(index)"
          @move-down="moveDown(index)"
          @indent="indent(index)"
          @outdent="outdent(index)"
          @navigate-up="navigateUp(index)"
          @navigate-down="navigateDown(index)"
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
  level?: number;
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

const editorId = `editor-${Math.random().toString(36).substring(2, 11)}`;
const instructions = ref<InstructionData[]>([]);
const mcpTools = ref<any[]>([]);
const documents = ref<any[]>([]);
const { getComponent } = useComponentRegistry();
let menuEl: HTMLDivElement | null = null;
let activeIndex = 0;
let currentQuery = "";
let commandMode: "select" | "actions" | "documents" = "select";
let isInternalUpdate = false;
let activeSlashContext: { slashIndex: number; textarea: HTMLElement } | null =
  null;

// Global menu state - once we enter actions/documents mode, stay there until reset
let isInSubMenu = false;
let subMenuMode: "actions" | "documents" | null = null;

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 11);

// Calculate hierarchical numbering for each instruction
const getHierarchicalNumber = (index: number): string => {
  const instruction = instructions.value[index];
  if (!instruction) return "1";

  const level = instruction.level || 0;
  const counters: number[] = new Array(level + 1).fill(0);

  // Go through all instructions up to current index
  for (let i = 0; i <= index; i++) {
    const item = instructions.value[i];
    if (!item) continue;

    const itemLevel = item.level || 0;

    // Reset deeper level counters when we encounter a shallower level
    if (itemLevel < level) {
      for (let j = itemLevel + 1; j <= level; j++) {
        counters[j] = 0;
      }
    }

    // Increment counter at this level
    counters[itemLevel]++;
  }

  // Build hierarchical number from the counters
  const result: number[] = [];
  for (let i = 0; i <= level; i++) {
    result.push(counters[i]);
  }

  return result.join(".");
};

// Initialize instructions from modelValue
const initializeInstructions = () => {
  if (Array.isArray(props.modelValue) && props.modelValue.length > 0) {
    instructions.value = props.modelValue.map((item) => ({
      id: item.id,
      instructions: item.instructions,
      level: item.level || 0,
    }));
  } else {
    instructions.value = [{ id: generateId(), instructions: "", level: 0 }];
  }
};

// Convert to the target format
const convertToTargetFormat = (): InstructionData[] => {
  return instructions.value.filter((item) => item.instructions.trim());
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
  instructions.value.push({ id: generateId(), instructions: "", level: 0 });
  emitChange();
};

const deleteInstruction = (index: number) => {
  instructions.value.splice(index, 1);
  if (instructions.value.length === 0) {
    addInstruction();
  }
  emitChange();

  // Focus the previous instruction if available, otherwise focus the next one
  nextTick(() => {
    const targetIndex = index > 0 ? index - 1 : 0;
    const instructionElements = document.querySelectorAll(
      ".instruction-item-wrapper"
    );
    const targetElement = instructionElements[targetIndex];
    if (targetElement) {
      const editor = targetElement.querySelector(
        "[contenteditable]"
      ) as HTMLElement;
      if (editor) {
        editor.focus();
        // Position cursor at end of the previous instruction
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false); // Collapse to end
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  });
};

const addSibling = (index: number) => {
  const currentLevel = instructions.value[index]?.level || 0;

  // Always create a new sibling instruction when addSibling is called
  instructions.value.splice(index + 1, 0, {
    id: generateId(),
    instructions: "",
    level: currentLevel,
  });
  emitChange();

  // Focus the newly created instruction
  nextTick(() => {
    const instructionElements = document.querySelectorAll(
      ".instruction-item-wrapper"
    );
    const targetElement = instructionElements[index + 1];
    if (targetElement) {
      const editor = targetElement.querySelector(
        "[contenteditable]"
      ) as HTMLElement;
      if (editor) {
        editor.focus();
        // Position cursor at start of the new (empty) instruction
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(true); // Collapse to start
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  });
};

const addChild = (index: number) => {
  const currentLevel = instructions.value[index]?.level || 0;
  instructions.value.splice(index + 1, 0, {
    id: generateId(),
    instructions: "",
    level: currentLevel + 1,
  });
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
  if (index > 0 && instructions.value[index]) {
    const currentLevel = instructions.value[index].level || 0;
    const previousLevel = instructions.value[index - 1]?.level || 0;

    // Only allow indenting if it would be at most one level deeper than the previous item
    const maxAllowedLevel = previousLevel + 1;
    if (currentLevel < maxAllowedLevel) {
      instructions.value[index].level = currentLevel + 1;
      emitChange();
    }
  }
};

const outdent = (index: number) => {
  if (instructions.value[index] && (instructions.value[index].level || 0) > 0) {
    instructions.value[index].level = Math.max(
      0,
      (instructions.value[index].level || 0) - 1
    );
    emitChange();
  }
};

const navigateUp = (index: number) => {
  if (index > 0) {
    nextTick(() => {
      const instructionElements = document.querySelectorAll(
        ".instruction-item-wrapper"
      );
      const targetElement = instructionElements[index - 1];
      if (targetElement) {
        const editor = targetElement.querySelector(
          "[contenteditable]"
        ) as HTMLElement;
        if (editor) {
          editor.focus();
          // Position cursor at end
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    });
  }
};

const navigateDown = (index: number) => {
  if (index < instructions.value.length - 1) {
    nextTick(() => {
      const instructionElements = document.querySelectorAll(
        ".instruction-item-wrapper"
      );
      const targetElement = instructionElements[index + 1];
      if (targetElement) {
        const editor = targetElement.querySelector(
          "[contenteditable]"
        ) as HTMLElement;
        if (editor) {
          editor.focus();
          // Position cursor at start
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    });
  }
};

// Highlight matching text in bold
function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text;

  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi"
  );
  return text.replace(regex, "<strong>$1</strong>");
}

// Slash command helpers
function ensureMenu() {
  if (!menuEl) {
    menuEl = document.createElement("div");
    menuEl.className = "mention-menu";
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
      <div class="mention-item ${
        activeIndex === 0 ? "active" : ""
      }" data-type="actions">
        <div class="mention-item-icon">⚡</div>
        <div class="mention-item-content">
          <div class="mention-item-name">Actions</div>
          <div class="mention-item-meta">Insert MCP tool action</div>
        </div>
      </div>
      <div class="mention-item ${
        activeIndex === 1 ? "active" : ""
      }" data-type="documents">
        <div class="mention-item-icon"></div>
        <div class="mention-item-content">
          <div class="mention-item-name">Documents</div>
          <div class="mention-item-meta">Reference a document</div>
        </div>
      </div>
    `;
  } else if (commandMode === "actions") {
    if (items.length === 0) {
      html = `
        <div class="mention-item mention-no-results">
          <div class="mention-item-icon">🔍</div>
          <div class="mention-item-content">
            <div class="mention-item-name">No actions found</div>
            <div class="mention-item-meta">Try a different search term</div>
          </div>
        </div>
      `;
    } else {
      html = items
        .map(
          (tool, i) => `
        <div class="mention-item mention-item-action ${
          i === activeIndex ? "active" : ""
        }" data-id="${tool.id}">
          <div class="mention-item-icon">⚡</div>
          <div class="mention-item-content">
            <div class="mention-item-name">${highlightMatch(
              tool.name,
              currentQuery
            )}</div>
            <div class="mention-item-meta">${highlightMatch(
              tool.label,
              currentQuery
            )} - ${highlightMatch(tool.pluginName, currentQuery)}</div>
          </div>
        </div>
      `
        )
        .join("");
    }
  } else if (commandMode === "documents") {
    if (items.length === 0) {
      html = `
        <div class="mention-item mention-no-results">
          <div class="mention-item-icon">🔍</div>
          <div class="mention-item-content">
            <div class="mention-item-name">No documents found</div>
            <div class="mention-item-meta">Try a different search term</div>
          </div>
        </div>
      `;
    } else {
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
          <div class="mention-item mention-item-document ${
            i === activeIndex ? "active" : ""
          }" data-id="${doc.id}">
            <div class="mention-item-icon"></div>
            <div class="mention-item-content">
              <div class="mention-item-name">${highlightMatch(
                doc.name || "Untitled",
                currentQuery
              )}</div>
              <div class="mention-item-meta">${highlightMatch(
                metaInfo,
                currentQuery
              )}</div>
            </div>
          </div>
        `;
        })
        .join("");
    }
  }

  el.innerHTML = html;

  // Add mouse interactions
  el.querySelectorAll(".mention-item").forEach((node, i) => {
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
      const items =
        commandMode === "actions"
          ? filterTools(currentQuery)
          : filterDocuments(currentQuery);
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
  const richInputWrapper = editorElement.closest(".rich-instruction-input");
  if (!richInputWrapper) return;

  const componentId = richInputWrapper.getAttribute("data-component-id");
  if (!componentId) return;

  // Get the component instance from the registry
  const componentInstance = getComponent(componentId);
  if (componentInstance && componentInstance.insertReference) {
    componentInstance.insertReference("action", tool);
  }
}

function insertDocument(doc: any) {
  if (!activeSlashContext) return;

  // Find the corresponding RichInstructionInput component
  const editorElement = activeSlashContext.textarea;
  const richInputWrapper = editorElement.closest(".rich-instruction-input");
  if (!richInputWrapper) return;

  const componentId = richInputWrapper.getAttribute("data-component-id");
  if (!componentId) return;

  // Get the component instance from the registry
  const componentInstance = getComponent(componentId);
  if (componentInstance && componentInstance.insertReference) {
    componentInstance.insertReference("document", doc);
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
const handleSlashCommand = (data: {
  query: string;
  slashIndex: number;
  textarea: HTMLElement;
  mode?: string;
}) => {
  const { query, slashIndex, textarea, mode } = data;

  console.log(
    `[DEBUG] Parent received: query="${query}", mode="${
      mode || "undefined"
    }", isInSubMenu=${isInSubMenu}, subMenuMode=${subMenuMode}`
  );

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
    console.log(
      `[DEBUG] Staying in ${subMenuMode} mode for filtering, query="${query}"`
    );
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

    const maxIndex = commandMode === "select" ? 2 : Math.max(1, items.length);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // Don't allow navigation if there are no results (only the no-results message)
      if (commandMode !== "select" && items.length === 0) {
        return;
      }

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

// Handle clicks on the instructions list area
function handleListClick(e: MouseEvent) {
  const target = e.target as HTMLElement;

  // Check if the click was on the list container itself or empty space
  // (not on an instruction item or its children)
  const isOnListContainer = target.classList.contains("instructions-list");
  const isOnEmptySpace = !target.closest(".instruction-item-wrapper");

  if (isOnListContainer || isOnEmptySpace) {
    // Focus the last instruction item
    if (instructions.value.length > 0) {
      const lastIndex = instructions.value.length - 1;
      nextTick(() => {
        // Find the last instruction item's editor
        const lastInstructionWrapper = document.querySelectorAll(
          ".instruction-item-wrapper"
        )[lastIndex];
        if (lastInstructionWrapper) {
          const editor = lastInstructionWrapper.querySelector(
            "[contenteditable]"
          ) as HTMLElement;
          if (editor) {
            editor.focus();
            // Place cursor at end
            const selection = window.getSelection();
            if (selection) {
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        }
      });
    }
  }
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
.instructions-editor-container {
  min-height: 200px;
  border: 1px solid hsl(var(--border));
  border-radius: 0.375rem;
  background-color: hsl(var(--background));
  padding: 1rem;
}

.instructions-editor-container:focus-within {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
}

.instructions-editor-error {
  border-color: rgb(239, 68, 68);
}

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

.rich-instruction-input {
  width: 100%;
}

.instruction-content {
  background: transparent;
  border: none;
  flex: 1;
  font-size: 0.875rem;
  min-height: 1.5rem;
  outline: none;
  overflow-wrap: break-word;
  padding: 0.25rem 0.5rem;
  resize: none;
  word-wrap: break-word;
}

.instruction-content:empty::after {
  content: attr(data-placeholder);
  color: hsl(var(--muted-foreground));
  pointer-events: none;
}

/* Base styles for all mention merge field icons */
.mention-merge-field.mention-action:before,
.mention-merge-field.mention-document:before {
  content: "";
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.25rem;
  vertical-align: middle;
  transform: translateY(-0.2em);
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.mention-merge-field.mention-action:before {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3.99999 14.0002C3.81076 14.0008 3.62522 13.9477 3.46495 13.8471C3.30467 13.7465 3.17623 13.6025 3.09454 13.4318C3.01286 13.2611 2.98129 13.0707 3.00349 12.8828C3.0257 12.6949 3.10077 12.5171 3.21999 12.3702L13.12 2.17016C13.1943 2.08444 13.2955 2.02652 13.407 2.0059C13.5185 1.98527 13.6337 2.00318 13.7337 2.05667C13.8337 2.11016 13.9126 2.19606 13.9573 2.30027C14.0021 2.40448 14.0101 2.52081 13.98 2.63016L12.06 8.65016C12.0034 8.80169 11.9844 8.96468 12.0046 9.12517C12.0248 9.28566 12.0837 9.43884 12.1761 9.57159C12.2685 9.70434 12.3918 9.81268 12.5353 9.88732C12.6788 9.96197 12.8382 10.0007 13 10.0002H20C20.1892 9.99952 20.3748 10.0526 20.535 10.1532C20.6953 10.2538 20.8238 10.3978 20.9054 10.5685C20.9871 10.7392 21.0187 10.9296 20.9965 11.1175C20.9743 11.3054 20.8992 11.4832 20.78 11.6302L10.88 21.8302C10.8057 21.9159 10.7045 21.9738 10.593 21.9944C10.4815 22.0151 10.3663 21.9972 10.2663 21.9437C10.1663 21.8902 10.0874 21.8043 10.0427 21.7001C9.99791 21.5958 9.98991 21.4795 10.02 21.3702L11.94 15.3502C11.9966 15.1986 12.0156 15.0356 11.9954 14.8752C11.9752 14.7147 11.9163 14.5615 11.8239 14.4287C11.7315 14.296 11.6082 14.1876 11.4647 14.113C11.3212 14.0384 11.1617 13.9996 11 14.0002H3.99999Z' fill='%239333EA'/%3E%3C/svg%3E%0A");
}

.mention-merge-field.mention-document:before {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 18V6C6 5.46957 6.19754 4.96086 6.54917 4.58579C6.90081 4.21071 7.37772 4 7.875 4H17.25C17.4489 4 17.6397 4.08429 17.7803 4.23431C17.921 4.38434 18 4.58783 18 4.8V19.2C18 19.4122 17.921 19.6157 17.7803 19.7657C17.6397 19.9157 17.4489 20 17.25 20H7.875C7.37772 20 6.90081 19.7893 6.54917 19.4142C6.19754 19.0391 6 18.5304 6 18ZM6 18C6 17.4696 6.19754 16.9609 6.54917 16.5858C6.90081 16.2107 7.37772 16 7.875 16H18' stroke='%23D97706' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Crect x='7' y='5' width='11' height='11' fill='%23D97706'/%3E%3C/svg%3E%0A");
}

.instruction-number {
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  min-width: 1.5rem;
  text-align: right;
  padding-top: 0.25rem;
  user-select: none;
  font-size: 0.875rem;
}

.instruction-item:has(.focused) .instruction-number {
  color: hsl(var(--primary));
  text-shadow: 0 2px 8px hsl(var(--primary) / 0.18);
}

kbd {
  background-color: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
}

/* MCP Merge Field Styles */
.mention-merge-field {
  display: inline;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: default;
  user-select: none;
  vertical-align: middle;
  font-weight: 500;
}

.mention-merge-field.mention-action {
  background: rgb(147, 51, 234, 0.1);
  border: 1px solid rgb(147, 51, 234, 0.3);
  color: #9333ea;
}

.mention-merge-field.mention-action:hover {
  background: rgb(147, 51, 234, 0.15);
  border-color: rgb(147, 51, 234, 0.5);
}

.mention-merge-field.mention-document {
  background: rgb(245, 158, 11, 0.1);
  border: 1px solid rgb(245, 158, 11, 0.3);
  color: #d97706;
}

.mention-merge-field.mention-document:hover {
  background: rgb(245, 158, 11, 0.15);
  border-color: rgb(245, 158, 11, 0.5);
}

/* Base icon styles */
.mention-item-icon {
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  height: 1em;
  width: 1em;
  color: transparent;
}

/* Icon images */
.mention-item-action .mention-item-icon,
[data-type="actions"] .mention-item-icon,
.mention-action .mention-item-icon {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3.99999 14.0002C3.81076 14.0008 3.62522 13.9477 3.46495 13.8471C3.30467 13.7465 3.17623 13.6025 3.09454 13.4318C3.01286 13.2611 2.98129 13.0707 3.00349 12.8828C3.0257 12.6949 3.10077 12.5171 3.21999 12.3702L13.12 2.17016C13.1943 2.08444 13.2955 2.02652 13.407 2.0059C13.5185 1.98527 13.6337 2.00318 13.7337 2.05667C13.8337 2.11016 13.9126 2.19606 13.9573 2.30027C14.0021 2.40448 14.0101 2.52081 13.98 2.63016L12.06 8.65016C12.0034 8.80169 11.9844 8.96468 12.0046 9.12517C12.0248 9.28566 12.0837 9.43884 12.1761 9.57159C12.2685 9.70434 12.3918 9.81268 12.5353 9.88732C12.6788 9.96197 12.8382 10.0007 13 10.0002H20C20.1892 9.99952 20.3748 10.0526 20.535 10.1532C20.6953 10.2538 20.8238 10.3978 20.9054 10.5685C20.9871 10.7392 21.0187 10.9296 20.9965 11.1175C20.9743 11.3054 20.8992 11.4832 20.78 11.6302L10.88 21.8302C10.8057 21.9159 10.7045 21.9738 10.593 21.9944C10.4815 22.0151 10.3663 21.9972 10.2663 21.9437C10.1663 21.8902 10.0874 21.8043 10.0427 21.7001C9.99791 21.5958 9.98991 21.4795 10.02 21.3702L11.94 15.3502C11.9966 15.1986 12.0156 15.0356 11.9954 14.8752C11.9752 14.7147 11.9163 14.5615 11.8239 14.4287C11.7315 14.296 11.6082 14.1876 11.4647 14.113C11.3212 14.0384 11.1617 13.9996 11 14.0002H3.99999Z' fill='%239333EA'/%3E%3C/svg%3E%0A");
}

.mention-item-document .mention-item-icon,
[data-type="documents"] .mention-item-icon,
.mention-document .mention-item-icon {
  background-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M6 18V6C6 5.46957 6.19754 4.96086 6.54917 4.58579C6.90081 4.21071 7.37772 4 7.875 4H17.25C17.4489 4 17.6397 4.08429 17.7803 4.23431C17.921 4.38434 18 4.58783 18 4.8V19.2C18 19.4122 17.921 19.6157 17.7803 19.7657C17.6397 19.9157 17.4489 20 17.25 20H7.875C7.37772 20 6.90081 19.7893 6.54917 19.4142C6.19754 19.0391 6 18.5304 6 18ZM6 18C6 17.4696 6.19754 16.9609 6.54917 16.5858C6.90081 16.2107 7.37772 16 7.875 16H18' stroke='%23D97706' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3Crect x='7' y='5' width='11' height='11' fill='%23D97706'/%3E%3C/svg%3E%0A");
}

/* MCP Command Palette Menu */
.mention-menu {
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

.mention-item {
  display: flex;
  align-items: center;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  border-radius: 0.375rem;
  transition: all 0.15s ease;
  margin-bottom: 0.125rem;
  gap: 0.75rem;
}

.mention-item:last-child {
  margin-bottom: 0;
}

.mention-item:hover,
.mention-item.active {
  background: hsl(var(--muted));
}

.mention-item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.3;
}

.mention-item-name {
  font-weight: 500;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  margin-bottom: 0.125rem;
}

.mention-item-meta {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

/* Action and Document themed menu items */
.mention-item-action.active,
.mention-item-action:hover {
  background: rgb(147, 51, 234, var(--active-hover, 0.08));
}

.mention-item-action.active {
  --active-hover: 0.1;
}

.mention-item-document.active,
.mention-item-document:hover {
  background: rgb(245, 158, 11, var(--active-hover, 0.08));
}

.mention-item-document.active {
  --active-hover: 0.1;
}

/* No results message styling */
.mention-item.mention-no-results {
  cursor: default;
  pointer-events: none;
  opacity: 0.7;
}

.mention-no-results .mention-item-icon {
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
}

.mention-no-results .mention-item-name,
.mention-no-results .mention-item-meta {
  color: hsl(var(--muted-foreground));
}

.mention-no-results .mention-item-name {
  font-style: italic;
}
</style>
