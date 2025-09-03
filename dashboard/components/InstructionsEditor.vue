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
      class="min-h-[200px] border rounded-md bg-background"
      :class="{ 'border-red-500': error }"
    ></div>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="hint" class="text-sm text-muted-foreground">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, nextTick, toRaw, ref } from "vue";
import EditorJS from "@editorjs/editorjs";
// @ts-ignore - EditorJS list plugin has incomplete TypeScript definitions
import List from "@editorjs/list";
// @ts-ignore - EditorJS undo plugin has incomplete TypeScript definitions
import Undo from "editorjs-undo";
import { HayApi } from "@/utils/api";
import MCPMergeField from "@/utils/MCPMergeField";

interface Props {
  modelValue: any;
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
  "update:modelValue": [value: any];
}>();

let editor: EditorJS | null = null;
let undo: any = null;
let isInternalUpdate = false;
const editorId = `editor-${Math.random().toString(36).substr(2, 9)}`;
const mcpTools = ref<any[]>([]);
const documents = ref<any[]>([]);
let menuEl: HTMLDivElement | null = null;
let activeIndex = 0;
let currentQuery = "";
let commandMode: "select" | "actions" | "documents" = "select";

// Fetch MCP tools from the API
const fetchMCPTools = async () => {
  try {
    const tools = await HayApi.plugins.getMCPTools.query();
    mcpTools.value = tools;
    console.log("Fetched MCP tools:", mcpTools.value);
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

    // Safely map documents with default values
    documents.value = (result.items || [])
      .map((doc: any) => ({
        id: doc.id || "",
        name: doc.name || doc.title || "Untitled Document",
        type: doc.type || "document",
        url: doc.url || "",
      }))
      .filter((doc) => doc.id && doc.name); // Filter out invalid documents

    console.log("Fetched documents:", documents.value);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    documents.value = [];
  }
};

// Type-ahead helper functions
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
    // Show type selection menu
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
    // Show actions (MCP tools)
    html = items
      .map(
        (tool, i) => `
      <div class="mcp-item mcp-item-action ${
        i === activeIndex ? "active" : ""
      }" data-id="${tool.id}">
        <div class="mcp-item-icon">⚡</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">${tool.name}</div>
          <div class="mcp-item-meta">${tool.label} - ${tool.pluginName}</div>
        </div>
      </div>
    `
      )
      .join("");
  } else if (commandMode === "documents") {
    // Show documents
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
            <div class="mcp-item-name">${doc.name || "Untitled"}</div>
            <div class="mcp-item-meta">${metaInfo}</div>
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
}

function getCaretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  if (range.getClientRects().length) return range.getClientRects()[0];

  const dummy = document.createElement("span");
  dummy.appendChild(document.createTextNode("\u200b"));
  range.insertNode(dummy);
  const rect = dummy.getBoundingClientRect();
  dummy.remove();
  return rect;
}

function findSlashToken() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const anchor = sel.anchorNode;
  if (!anchor) return null;

  // Handle both text nodes and element nodes
  let textNode: Text | null = null;
  let text = "";
  let caretOffset = sel.anchorOffset;

  if (anchor.nodeType === Node.TEXT_NODE) {
    textNode = anchor as Text;
    text = textNode.textContent || "";
  } else if (anchor.nodeType === Node.ELEMENT_NODE) {
    // If we're in an element, try to find the text node
    const element = anchor as Element;
    if (
      element.childNodes.length > 0 &&
      caretOffset < element.childNodes.length
    ) {
      const child = element.childNodes[caretOffset];
      if (child.nodeType === Node.TEXT_NODE) {
        textNode = child as Text;
        text = textNode.textContent || "";
        caretOffset = 0; // Reset offset for the text node
      }
    }
  }

  if (!textNode || !text) return null;

  // Find the slash token
  const left = text.lastIndexOf("/", caretOffset - 1);
  if (left === -1) return null;

  // Stop at whitespace or certain punctuation
  const token = text.slice(left, caretOffset);
  if (!token.startsWith("/")) return null;
  if (/[\s\n\r]/.test(token)) return null;

  return { node: textNode, start: left, end: caretOffset, token };
}

function replaceRangeWithSpan(
  node: Text,
  start: number,
  end: number,
  span: HTMLElement
) {
  const text = node.textContent || "";
  const before = text.slice(0, start);
  const after = text.slice(end);

  const parent = node.parentNode!;

  // Create text nodes
  const beforeNode = before ? document.createTextNode(before) : null;
  const afterNode = document.createTextNode(after || " "); // Always ensure there's at least a space after

  // Insert nodes in order
  if (beforeNode) {
    parent.insertBefore(beforeNode, node);
  }
  parent.insertBefore(span, node);
  parent.insertBefore(afterNode, node);
  parent.removeChild(node);

  // Place caret in the text node after the span
  const range = document.createRange();
  range.setStart(afterNode, after ? 0 : 1); // If we added a space, position after it
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function handleItemSelection(item: any) {
  if (commandMode === "select") {
    // Type selection - move to next mode
    const type = activeIndex === 0 ? "actions" : "documents";
    commandMode = type as "actions" | "documents";
    activeIndex = 0;

    const ctx = findSlashToken();
    if (!ctx) return;

    const rect = getCaretRect();
    if (rect) {
      const items =
        commandMode === "actions"
          ? filterTools(currentQuery)
          : filterDocuments(currentQuery);
      showMenu(rect, items);
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
  const ctx = findSlashToken();
  if (!ctx) {
    console.log("No slash token context found");
    return;
  }

  const span = document.createElement("span");
  span.className = "mcp-merge-field mcp-action";
  span.contentEditable = "false";
  span.dataset.mcpTool = tool.id;
  span.dataset.plugin = tool.pluginName;
  span.innerHTML = `<span class="mcp-item-icon"></span>${tool.name}`;

  replaceRangeWithSpan(ctx.node, ctx.start, ctx.end, span);

  // Force focus back to editor after insertion
  const holder = document.getElementById(editorId);
  if (holder) {
    holder.focus();
  }

  // Trigger Editor.js save to capture the change
  if (editor) {
    setTimeout(() => {
      editor?.save();
    }, 100);
  }
}

function insertDocument(doc: any) {
  const ctx = findSlashToken();
  if (!ctx) {
    console.log("No slash token context found");
    return;
  }

  const span = document.createElement("span");
  span.className = "mcp-merge-field mcp-document";
  span.contentEditable = "false";
  span.dataset.documentId = doc.id;
  span.dataset.documentName = doc.name;
  span.innerHTML = `<span class="mcp-item-icon"></span>${doc.name}`;

  replaceRangeWithSpan(ctx.node, ctx.start, ctx.end, span);

  // Force focus back to editor after insertion
  const holder = document.getElementById(editorId);
  if (holder) {
    holder.focus();
  }

  // Trigger Editor.js save to capture the change
  if (editor) {
    setTimeout(() => {
      editor?.save();
    }, 100);
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

function onKeyDown(e: KeyboardEvent) {
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
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === "ArrowDown") {
        activeIndex = (activeIndex + 1) % maxIndex; // Wrap around
      } else {
        activeIndex = activeIndex === 0 ? maxIndex - 1 : activeIndex - 1; // Wrap around
      }

      const rect = getCaretRect();
      if (rect) showMenu(rect, items);
      return false; // Extra prevention
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideMenu();
      return false;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (items.length > 0) {
        handleItemSelection(items[activeIndex]);
      }
      return false;
    }
  }
}

function onKeyUp() {
  const ctx = findSlashToken();
  if (!ctx) {
    hideMenu();
    return;
  }

  const fullToken = ctx.token.slice(1); // Remove '/'

  // Check for shortcuts
  if (fullToken.startsWith("a")) {
    commandMode = "actions";
    currentQuery = fullToken.slice(1); // Remove 'a'
    activeIndex = 0;
  } else if (fullToken.startsWith("d")) {
    commandMode = "documents";
    currentQuery = fullToken.slice(1); // Remove 'd'
    activeIndex = 0;
  } else {
    // No shortcut, show type selection
    if (commandMode === "select") {
      currentQuery = fullToken;
    } else {
      // Already in a mode, update query
      const newQuery = fullToken;
      if (newQuery !== currentQuery) {
        activeIndex = 0;
      }
      currentQuery = newQuery;
    }
  }

  let items: any[] = [];
  if (commandMode === "select") {
    items = [{ type: "actions" }, { type: "documents" }];
  } else if (commandMode === "actions") {
    items = filterTools(currentQuery);
  } else if (commandMode === "documents") {
    items = filterDocuments(currentQuery);
  }

  if (commandMode !== "select" && items.length === 0) {
    hideMenu();
    return;
  }

  const rect = getCaretRect();
  if (rect) showMenu(rect, items);
}

const initEditor = async () => {
  try {
    // Convert proxy to plain object if needed
    const initialData = props.modelValue
      ? JSON.parse(JSON.stringify(toRaw(props.modelValue)))
      : { blocks: [] };

    editor = new EditorJS({
      holder: editorId,
      placeholder: props.placeholder,
      minHeight: 200,
      hideToolbar: true, // Hide the block settings toolbar
      tools: {
        list: {
          class: List as any,
          inlineToolbar: false, // Disable inline toolbar for list
          config: {
            defaultStyle: "ordered",
          },
        },
        mcpMergeField: {
          class: MCPMergeField,
        },
      },
      inlineToolbar: false, // Disable inline toolbar completely
      defaultBlock: "list",
      data: initialData,
      onChange: async () => {
        if (isInternalUpdate) return;

        try {
          const outputData = await editor?.save();
          isInternalUpdate = true;
          emit("update:modelValue", outputData);
          setTimeout(() => {
            isInternalUpdate = false;
          }, 0);
        } catch (error) {
          console.error("Error saving editor data:", error);
        }
      },
    });

    await editor.isReady;

    // Store the merge field instance for programmatic use
    // The inline toolbar tools aren't directly accessible in Editor.js API
    // We'll rely on the programmatic insertion via DOM manipulation

    // Initialize undo/redo after editor is ready
    try {
      undo = new Undo({ editor });
      undo.initialize();
    } catch (undoError) {
      console.warn("Undo plugin initialization failed:", undoError);
      undo = null;
    }

    // Add event listeners for type-ahead
    const holder = document.getElementById(editorId);
    if (holder) {
      // Use capture phase to ensure we get events before Editor.js processes them
      holder.addEventListener("keyup", onKeyUp, true);
      holder.addEventListener("keydown", onKeyDown, true);

      // Also listen for input events to catch any text changes
      holder.addEventListener("input", onKeyUp, true);
    }

    // Add global click listener to hide menu
    document.addEventListener("click", (e) => {
      if (menuEl && e.target instanceof Node && !menuEl.contains(e.target)) {
        hideMenu();
      }
    });
  } catch (error) {
    console.error("Error initializing editor:", error);
  }
};

onMounted(async () => {
  // Fetch MCP tools and documents first
  await Promise.all([fetchMCPTools(), fetchDocuments()]);

  // Then initialize the editor after ensuring data is loaded
  await nextTick();
  initEditor();
});

onBeforeUnmount(() => {
  // Remove event listeners (matching the capture phase used in setup)
  const holder = document.getElementById(editorId);
  if (holder) {
    holder.removeEventListener("keyup", onKeyUp, true);
    holder.removeEventListener("keydown", onKeyDown, true);
    holder.removeEventListener("input", onKeyUp, true);
  }

  // Clean up menu
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }

  // Destroy undo if it exists and has a destroy method
  if (undo && typeof undo.destroy === "function") {
    try {
      undo.destroy();
    } catch (error) {
      console.warn("Error destroying undo:", error);
    }
    undo = null;
  }

  // Destroy editor if it exists
  if (editor && typeof editor.destroy === "function") {
    try {
      editor.destroy();
    } catch (error) {
      console.warn("Error destroying editor:", error);
    }
    editor = null;
  }
});

watch(
  () => props.modelValue,
  async (newValue) => {
    if (!editor || !editor.render || isInternalUpdate) return;

    try {
      const currentData = await editor.save();
      const newData = newValue ? toRaw(newValue) : { blocks: [] };

      // Only update if data actually changed
      if (JSON.stringify(currentData) !== JSON.stringify(newData)) {
        // Convert proxy to plain object before rendering
        const plainData = JSON.parse(JSON.stringify(newData));
        await editor.render(plainData);
      }
    } catch (error) {
      console.error("Error updating editor:", error);
    }
  },
  { deep: true }
);
</script>

<style>
.codex-editor {
  padding: 1rem;
}

.ce-block__content {
  max-width: 100%;
}

.ce-toolbar__actions {
  right: 1rem;
}

.cdx-list {
  padding-left: 1.5rem;
}

.cdx-list__item {
  padding: 0.25rem 0;
  line-height: 1.6;
}

.ce-paragraph {
  line-height: 1.6;
}

.codex-editor--empty
  .ce-block:first-child
  .ce-paragraph[data-placeholder]:empty::before {
  color: hsl(var(--muted-foreground));
  opacity: 0.5;
}

.codex-editor__redactor {
  padding-bottom: 2rem !important;
}

/* Hide all Editor.js toolbars and buttons */
.ce-toolbar {
  display: none !important;
}

.ce-inline-toolbar {
  display: none !important;
}

.ce-toolbox {
  display: none !important;
}

.ce-settings {
  display: none !important;
}

/* Hide paragraph tool from the toolbox */
.ce-toolbox__button[data-tool="paragraph"] {
  display: none !important;
}

/* Hide unordered list button in the list settings */
.cdx-list-settings .cdx-list-settings__button:first-child {
  display: none !important;
}

/* Always show numbers for ordered lists */
.cdx-list--ordered {
  list-style: decimal !important;
}

.cdx-list--ordered .cdx-list__item {
  display: list-item !important;
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
