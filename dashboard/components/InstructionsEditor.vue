<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label :for="editorId" class="text-sm font-medium">
        {{ label }}
      </label>
      <div class="text-xs text-muted-foreground">
        Press
        <kbd class="px-1.5 py-0.5 text-xs font-semibold bg-muted rounded"
          >Cmd/Ctrl + Z</kbd
        >
        to undo,
        <kbd class="px-1.5 py-0.5 text-xs font-semibold bg-muted rounded"
          >Cmd/Ctrl + Y</kbd
        >
        to redo
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
let undo: Undo | null = null;
let isInternalUpdate = false;
const editorId = `editor-${Math.random().toString(36).substr(2, 9)}`;
const mcpTools = ref<any[]>([]);
const documents = ref<any[]>([]);
let menuEl: HTMLDivElement | null = null;
let activeIndex = 0;
let currentQuery = '';
let commandMode: 'select' | 'actions' | 'documents' = 'select';

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
    documents.value = (result.items || []).map((doc: any) => ({
      id: doc.id || '',
      name: doc.name || doc.title || 'Untitled Document',
      type: doc.type || 'document',
      url: doc.url || '',
    })).filter(doc => doc.id && doc.name); // Filter out invalid documents
    
    console.log("Fetched documents:", documents.value);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    documents.value = [];
  }
};

// Type-ahead helper functions
function ensureMenu() {
  if (!menuEl) {
    menuEl = document.createElement('div');
    menuEl.className = 'mcp-menu';
    document.body.appendChild(menuEl);
  }
  return menuEl;
}

function showMenu(rect: DOMRect, items: any[]) {
  const el = ensureMenu();
  el.style.display = 'block';
  el.style.position = 'fixed';
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 6}px`;
  el.style.zIndex = '9999';
  
  let html = '';
  
  if (commandMode === 'select') {
    // Show type selection menu
    html = `
      <div class="mcp-item ${activeIndex === 0 ? 'active' : ''}" data-type="actions">
        <div class="mcp-item-icon">⚡</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">Actions</div>
          <div class="mcp-item-meta">Insert MCP tool action</div>
        </div>
      </div>
      <div class="mcp-item ${activeIndex === 1 ? 'active' : ''}" data-type="documents">
        <div class="mcp-item-icon">📄</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">Documents</div>
          <div class="mcp-item-meta">Reference a document</div>
        </div>
      </div>
    `;
  } else if (commandMode === 'actions') {
    // Show actions (MCP tools)
    html = items.map((tool, i) => `
      <div class="mcp-item mcp-item-action ${i === activeIndex ? 'active' : ''}" data-id="${tool.id}">
        <div class="mcp-item-icon">⚡</div>
        <div class="mcp-item-content">
          <div class="mcp-item-name">${tool.name}</div>
          <div class="mcp-item-meta">${tool.label} - ${tool.pluginName}</div>
        </div>
      </div>
    `).join('');
  } else if (commandMode === 'documents') {
    // Show documents
    html = items.map((doc, i) => {
      let metaInfo = doc.type || 'document';
      if (doc.url) {
        try {
          metaInfo += ' • ' + new URL(doc.url).hostname;
        } catch (e) {
          // Invalid URL, just show type
        }
      }
      return `
        <div class="mcp-item mcp-item-document ${i === activeIndex ? 'active' : ''}" data-id="${doc.id}">
          <div class="mcp-item-icon">📄</div>
          <div class="mcp-item-content">
            <div class="mcp-item-name">${doc.name || 'Untitled'}</div>
            <div class="mcp-item-meta">${metaInfo}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  el.innerHTML = html;
  
  // Add mouse interactions
  el.querySelectorAll('.mcp-item').forEach((node, i) => {
    node.addEventListener('mouseenter', () => { 
      activeIndex = i; 
      showMenu(rect, items); 
    });
    node.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handleItemSelection(items[i]);
    });
  });
}

function hideMenu() {
  if (menuEl) menuEl.style.display = 'none';
  activeIndex = 0;
  currentQuery = '';
  commandMode = 'select';
}

function getCaretRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  if (range.getClientRects().length) return range.getClientRects()[0];
  
  const dummy = document.createElement('span');
  dummy.appendChild(document.createTextNode('\u200b'));
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
  let text = '';
  let caretOffset = sel.anchorOffset;
  
  if (anchor.nodeType === Node.TEXT_NODE) {
    textNode = anchor as Text;
    text = textNode.textContent || '';
  } else if (anchor.nodeType === Node.ELEMENT_NODE) {
    // If we're in an element, try to find the text node
    const element = anchor as Element;
    if (element.childNodes.length > 0 && caretOffset < element.childNodes.length) {
      const child = element.childNodes[caretOffset];
      if (child.nodeType === Node.TEXT_NODE) {
        textNode = child as Text;
        text = textNode.textContent || '';
        caretOffset = 0; // Reset offset for the text node
      }
    }
  }
  
  if (!textNode || !text) return null;
  
  // Find the slash token
  const left = text.lastIndexOf('/', caretOffset - 1);
  if (left === -1) return null;

  // Stop at whitespace or certain punctuation
  const token = text.slice(left, caretOffset);
  if (!token.startsWith('/')) return null;
  if (/[\s\n\r]/.test(token)) return null;

  return { node: textNode, start: left, end: caretOffset, token };
}

function replaceRangeWithSpan(node: Text, start: number, end: number, span: HTMLElement) {
  const text = node.textContent || '';
  const before = text.slice(0, start);
  const after = text.slice(end);

  const parent = node.parentNode!;
  
  // Create text nodes
  const beforeNode = before ? document.createTextNode(before) : null;
  const afterNode = document.createTextNode(after || ' '); // Always ensure there's at least a space after
  
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
  if (commandMode === 'select') {
    // Type selection - move to next mode
    const type = activeIndex === 0 ? 'actions' : 'documents';
    commandMode = type as 'actions' | 'documents';
    activeIndex = 0;
    
    const ctx = findSlashToken();
    if (!ctx) return;
    
    const rect = getCaretRect();
    if (rect) {
      const items = commandMode === 'actions' ? filterTools(currentQuery) : filterDocuments(currentQuery);
      showMenu(rect, items);
    }
  } else if (commandMode === 'actions') {
    insertAction(item);
    hideMenu();
  } else if (commandMode === 'documents') {
    insertDocument(item);
    hideMenu();
  }
}

function insertAction(tool: any) {
  const ctx = findSlashToken();
  if (!ctx) {
    console.log('No slash token context found');
    return;
  }

  const span = document.createElement('span');
  span.className = 'mcp-merge-field mcp-action';
  span.contentEditable = 'false';
  span.dataset.mcpTool = tool.id;
  span.dataset.plugin = tool.pluginName;
  span.textContent = `⚡${tool.name}`;
  
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
    console.log('No slash token context found');
    return;
  }

  const span = document.createElement('span');
  span.className = 'mcp-merge-field mcp-document';
  span.contentEditable = 'false';
  span.dataset.documentId = doc.id;
  span.dataset.documentName = doc.name;
  span.textContent = `📄${doc.name}`;
  
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
  return mcpTools.value.filter(tool => 
    tool.name.toLowerCase().includes(q) || 
    tool.label.toLowerCase().includes(q) ||
    tool.pluginName.toLowerCase().includes(q)
  );
}

function filterDocuments(query: string) {
  const q = query.toLowerCase();
  return documents.value.filter(doc => {
    if (!doc) return false;
    const nameMatch = doc.name && doc.name.toLowerCase().includes(q);
    const typeMatch = doc.type && doc.type.toLowerCase().includes(q);
    return nameMatch || typeMatch;
  });
}

function onKeyDown(e: KeyboardEvent) {
  if (menuEl && menuEl.style.display === 'block') {
    let items: any[] = [];
    
    if (commandMode === 'select') {
      items = [{ type: 'actions' }, { type: 'documents' }];
    } else if (commandMode === 'actions') {
      items = filterTools(currentQuery);
    } else if (commandMode === 'documents') {
      items = filterDocuments(currentQuery);
    }
    
    const maxIndex = commandMode === 'select' ? 2 : items.length;
    
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { 
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      if (e.key === 'ArrowDown') {
        activeIndex = (activeIndex + 1) % maxIndex; // Wrap around
      } else {
        activeIndex = activeIndex === 0 ? maxIndex - 1 : activeIndex - 1; // Wrap around
      }
      
      const rect = getCaretRect();
      if (rect) showMenu(rect, items);
      return false; // Extra prevention
    }
    
    if (e.key === 'Escape') { 
      e.preventDefault();
      e.stopPropagation();
      hideMenu(); 
      return false; 
    }
    
    if (e.key === 'Enter' || e.key === 'Tab') {
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
  if (fullToken.startsWith('a')) {
    commandMode = 'actions';
    currentQuery = fullToken.slice(1); // Remove 'a'
    activeIndex = 0;
  } else if (fullToken.startsWith('d')) {
    commandMode = 'documents';
    currentQuery = fullToken.slice(1); // Remove 'd'
    activeIndex = 0;
  } else {
    // No shortcut, show type selection
    if (commandMode === 'select') {
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
  if (commandMode === 'select') {
    items = [{ type: 'actions' }, { type: 'documents' }];
  } else if (commandMode === 'actions') {
    items = filterTools(currentQuery);
  } else if (commandMode === 'documents') {
    items = filterDocuments(currentQuery);
  }
  
  if (commandMode !== 'select' && items.length === 0) {
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
      hideToolbar: true,  // Hide the block settings toolbar
      tools: {
        list: {
          class: List as any,
          inlineToolbar: false,  // Disable inline toolbar for list
          config: {
            defaultStyle: "ordered",
          },
        },
        mcpMergeField: {
          class: MCPMergeField,
        },
      },
      inlineToolbar: false,  // Disable inline toolbar completely
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
      holder.addEventListener('keyup', onKeyUp, true);
      holder.addEventListener('keydown', onKeyDown, true);
      
      // Also listen for input events to catch any text changes
      holder.addEventListener('input', onKeyUp, true);
    }
    
    // Add global click listener to hide menu
    document.addEventListener('click', (e) => {
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
  await Promise.all([
    fetchMCPTools(),
    fetchDocuments(),
  ]);

  // Then initialize the editor after ensuring data is loaded
  await nextTick();
  initEditor();
});

onBeforeUnmount(() => {
  // Remove event listeners (matching the capture phase used in setup)
  const holder = document.getElementById(editorId);
  if (holder) {
    holder.removeEventListener('keyup', onKeyUp, true);
    holder.removeEventListener('keydown', onKeyDown, true);
    holder.removeEventListener('input', onKeyUp, true);
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
  display: inline-block;
  padding: 0.125rem 0.375rem;
  margin: 0 0.125rem;
  border-radius: 0.375rem;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
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
  color: rgb(147, 51, 234);
}

.mcp-merge-field.mcp-action:hover {
  background: rgb(147, 51, 234, 0.15);
  border-color: rgb(147, 51, 234, 0.5);
}

/* Document tokens (yellow/amber) */
.mcp-merge-field.mcp-document {
  background: rgb(245, 158, 11, 0.1);
  border: 1px solid rgb(245, 158, 11, 0.3);
  color: rgb(217, 119, 6);
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
}

.mcp-item:last-child {
  margin-bottom: 0;
}

.mcp-item:hover,
.mcp-item.active {
  background: hsl(var(--muted));
}

.mcp-item-icon {
  font-size: 1.125rem;
  margin-right: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
}

.mcp-item-content {
  flex: 1;
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

.mcp-item-action .mcp-item-icon {
  color: rgb(147, 51, 234);
}

/* Document items (yellow/amber theme) */
.mcp-item-document.active {
  background: rgb(245, 158, 11, 0.1);
}

.mcp-item-document:hover {
  background: rgb(245, 158, 11, 0.08);
}

.mcp-item-document .mcp-item-icon {
  color: rgb(217, 119, 6);
}
</style>
