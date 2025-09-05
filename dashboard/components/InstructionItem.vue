<template>
  <div class="instruction-item-wrapper">
    <div
      class="instruction-item"
      :class="{ 'indent-1': level > 0 }"
      :style="{ paddingLeft: `${level * 1.5}rem` }"
    >
      <div class="instruction-number">{{ hierarchicalNumber }}.</div>
      <RichInstructionInput
        ref="editorRef"
        v-model="localInstructions"
        :placeholder="
          level === 0 ? 'Enter instruction...' : 'Enter sub-instruction...'
        "
        :mcp-tools="mcpTools"
        :documents="documents"
        @slash-command="handleSlashCommand"
        @close-slash-menu="emit('close-slash-menu')"
        @keydown="handleKeyDown"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from "vue";
import RichInstructionInput from "@/components/RichInstructionInput.vue";

interface InstructionData {
  id: string;
  instructions: string;
  level?: number;
}

interface Props {
  modelValue: InstructionData;
  level: number;
  index: number;
  hierarchicalNumber: string;
  mcpTools: any[];
  documents: any[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:modelValue": [value: InstructionData];
  delete: [];
  "add-sibling": [];
  "add-child": [];
  "move-up": [];
  "move-down": [];
  indent: [];
  outdent: [];
  "navigate-up": [];
  "navigate-down": [];
  "slash-command": [
    data: {
      query: string;
      slashIndex: number;
      textarea: HTMLElement;
      mode?: string;
    }
  ];
  "close-slash-menu": [];
}>();

const editorRef = ref<InstanceType<typeof RichInstructionInput> | null>(null);

// Local instructions model
const localInstructions = computed({
  get: () => props.modelValue.instructions,
  set: (value: string) => {
    emit("update:modelValue", {
      ...props.modelValue,
      instructions: value,
    });
  },
});

// Generate unique ID
const generateId = () => Math.random().toString(36).substring(2, 11);

// No child management needed - flat structure

// Handle slash command from RichInstructionInput
const handleSlashCommand = (data: any) => {
  emit("slash-command", data);
};

// Handle keyboard events from RichInstructionInput
const handleKeyDown = (e: KeyboardEvent) => {
  const editor = editorRef.value?.$el?.querySelector(
    "[contenteditable]"
  ) as HTMLElement;
  if (!editor) return;

  // Check if slash command menu is open for keys that should be handled by parent
  const menuEl = document.querySelector(".mention-menu");
  const isMenuOpen =
    menuEl && (menuEl as HTMLElement).style.display === "block";

  if (isMenuOpen && e.key === "Escape") {
    // Let parent handle Escape to close menu
    return;
  }

  const selection = window.getSelection();
  const textValue = editor.textContent || "";
  let cursorPosition = 0;

  // Simplified cursor position detection for contenteditable
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    // Create a range from start of element to current cursor position
    const tempRange = document.createRange();
    tempRange.selectNodeContents(editor);
    tempRange.setEnd(range.startContainer, range.startOffset);
    cursorPosition = tempRange.toString().length;
  }

  if (e.key === "Enter") {
    if (e.shiftKey) {
      // Allow shift+enter for line breaks
      return;
    }

    // Check if slash command menu is open
    if (isMenuOpen) {
      // Menu is open, let the parent handle this key event
      return;
    }

    e.preventDefault();

    // Check if cursor is inside an MCP merge field - if so, move cursor to end of field
    const mcpField = findMcpFieldAtCursor(editor, selection);
    if (mcpField && selection) {
      // Move cursor to the end of the MCP field
      const newRange = document.createRange();
      newRange.setStartAfter(mcpField);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      // Recalculate cursor position
      cursorPosition = getTextOffset(
        editor,
        newRange.startContainer,
        newRange.startOffset
      );
    }

    // Get the current markdown content
    const richInputComponent = editorRef.value;
    let currentMarkdownContent = "";
    if (richInputComponent && richInputComponent.convertToMarkdown) {
      currentMarkdownContent = richInputComponent.convertToMarkdown(
        editor.innerHTML
      );
    } else {
      // Fallback: use existing text-based approach
      currentMarkdownContent = textValue;
    }

    // For safe splitting, we need to map the visual cursor position to the markdown cursor position
    const markdownCursorPosition = mapVisualToMarkdownPosition(
      editor,
      cursorPosition
    );

    // Split content at the correct position in markdown
    const beforeCursor = currentMarkdownContent.slice(
      0,
      markdownCursorPosition
    );
    const afterCursor = currentMarkdownContent.slice(markdownCursorPosition);

    // Check if current instruction is empty and the next one would also be empty
    if (beforeCursor.trim() === "" && afterCursor.trim() === "") {
      // Current instruction is empty - check if next instruction is also empty
      const nextTextarea = findNextEditor(editor);
      if (nextTextarea && (nextTextarea.textContent || "").trim() === "") {
        // Next instruction is also empty, just focus it instead of creating another empty one
        nextTextarea.focus();
        return;
      }
    }

    // Update current instruction with markdown content before cursor
    localInstructions.value = beforeCursor;

    // Handle special case: if we're at a level > 0 and current instruction is empty, outdent instead of creating new instruction
    if (
      props.level > 0 &&
      beforeCursor.trim() === "" &&
      afterCursor.trim() === ""
    ) {
      // We're indented and it's empty, outdent instead of creating new instruction
      emit("outdent");

      // Restore focus to the current editor after outdenting
      nextTick(() => {
        const editor = editorRef.value?.$el?.querySelector(
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
      });
      return;
    }

    // Create new sibling instruction
    emit("add-sibling");

    // Focus the next instruction after it's created
    nextTick(() => {
      // Find the next textarea in the tree structure
      const nextEditor = findNextEditor(editor);
      if (nextEditor) {
        // Set the content from after cursor if any
        if (afterCursor.trim()) {
          // Find the RichInstructionInput component for the next editor
          const nextRichInputWrapper = nextEditor.closest(
            ".rich-instruction-input"
          );
          if (nextRichInputWrapper) {
            // Set the content as text first, which will preserve markdown format
            nextEditor.textContent = afterCursor;
            // Trigger input event to update the model
            const inputEvent = new Event("input", { bubbles: true });
            nextEditor.dispatchEvent(inputEvent);
          } else {
            // Fallback for regular textareas
            nextEditor.textContent = afterCursor;
            const inputEvent = new Event("input", { bubbles: true });
            nextEditor.dispatchEvent(inputEvent);
          }
        }
        // Focus the next textarea
        nextEditor.focus();

        // Set cursor position
        if (afterCursor.trim()) {
          // Position cursor at start if we added content
          setCursorPosition(nextEditor, 0);
        } else {
          // Position cursor at end if empty
          setCursorPosition(nextEditor, nextEditor.textContent?.length || 0);
        }
      }
    });
  } else if (e.key === "Backspace") {
    if (cursorPosition === 0 && textValue === "") {
      e.preventDefault();
      if (props.level > 0) {
        emit("outdent");
      } else if (props.index > 0) {
        emit("delete");
      }
    }
  } else if (e.key === "Tab") {
    // Check if slash command menu is open
    if (isMenuOpen) {
      // Menu is open, let the parent handle tab for menu selection
      return;
    }

    e.preventDefault();
    if (e.shiftKey) {
      // Outdent
      if (props.level > 0) {
        emit("outdent");
      }
    } else {
      // Indent
      emit("indent");
    }

    // Restore focus to the current editor after indentation
    nextTick(() => {
      const editor = editorRef.value?.$el?.querySelector(
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
    });
  } else if (e.key === "ArrowUp" && cursorPosition === 0) {
    // Check if slash command menu is open
    if (isMenuOpen) {
      // Menu is open, let the parent handle arrow keys for menu navigation
      return;
    }

    // Move to previous item
    e.preventDefault();
    emit("navigate-up");
  } else if (e.key === "ArrowDown" && cursorPosition === textValue.length) {
    // Check if slash command menu is open
    if (isMenuOpen) {
      // Menu is open, let the parent handle arrow keys for menu navigation
      return;
    }

    // Move to next item
    e.preventDefault();
    emit("navigate-down");
  }
};

// Helper function to get text offset in contenteditable
const getTextOffset = (root: Node, node: Node, offset: number): number => {
  let textOffset = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

  let currentNode;
  while ((currentNode = walker.nextNode())) {
    if (currentNode === node) {
      return textOffset + offset;
    }
    textOffset += currentNode.textContent?.length || 0;
  }

  return textOffset;
};

// Helper function to set cursor position
const setCursorPosition = (element: HTMLElement, position: number) => {
  const range = document.createRange();
  const selection = window.getSelection();

  let currentOffset = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

  let node;
  while ((node = walker.nextNode())) {
    const nodeLength = node.textContent?.length || 0;
    if (currentOffset + nodeLength >= position) {
      range.setStart(node, position - currentOffset);
      range.setEnd(node, position - currentOffset);
      break;
    }
    currentOffset += nodeLength;
  }

  selection?.removeAllRanges();
  selection?.addRange(range);
};

// Helper function to find if cursor is inside an MCP merge field
const findMcpFieldAtCursor = (
  editor: HTMLElement,
  selection: Selection | null
): Element | null => {
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  let node: Node | null = range.startContainer;

  // Walk up the DOM tree to find an MCP merge field
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (element.classList && element.classList.contains("mention-merge-field")) {
        return element;
      }
    }
    node = node.parentNode;
  }

  return null;
};

// Helper function to map visual cursor position to markdown position
const mapVisualToMarkdownPosition = (
  editor: HTMLElement,
  visualPosition: number
): number => {
  // This is a simplified approach - we'll iterate through the visual content
  // and build up the markdown content, tracking positions
  let visualOffset = 0;
  let markdownOffset = 0;

  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        // Accept text nodes and MCP merge field elements
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.classList &&
            element.classList.contains("mcp-merge-field")
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }
        return NodeFilter.FILTER_SKIP;
      },
    }
  );

  let currentNode;
  while ((currentNode = walker.nextNode())) {
    if (currentNode.nodeType === Node.TEXT_NODE) {
      const textLength = currentNode.textContent?.length || 0;
      if (visualOffset + textLength >= visualPosition) {
        // Found the position within this text node
        const offsetInNode = visualPosition - visualOffset;
        return markdownOffset + offsetInNode;
      }
      visualOffset += textLength;
      markdownOffset += textLength;
    } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
      const element = currentNode as Element;
      if (element.classList && element.classList.contains("mention-merge-field")) {
        const visualText = element.textContent || "";
        const visualLength = visualText.length;

        // Get the markdown equivalent
        const dataId = element.getAttribute("data-id");
        const dataType = element.getAttribute("data-type");
        let markdownEquivalent = "";
        if (dataType === "action" && dataId) {
          markdownEquivalent = `[action](${dataId})`;
        } else if (dataType === "document" && dataId) {
          markdownEquivalent = `[document](${dataId})`;
        } else {
          markdownEquivalent = visualText; // fallback
        }

        if (visualOffset + visualLength >= visualPosition) {
          // Cursor is within this MCP field - map to end of markdown equivalent
          return markdownOffset + markdownEquivalent.length;
        }

        visualOffset += visualLength;
        markdownOffset += markdownEquivalent.length;
      }
    }
  }

  return markdownOffset;
};

// Find the next contenteditable element in the entire instruction tree
const findNextEditor = (currentElement: HTMLElement): HTMLElement | null => {
  const currentWrapper = currentElement.closest(".instruction-item-wrapper");
  if (!currentWrapper) return null;

  // First, check if there are children of the current instruction
  const childrenContainer = currentWrapper.querySelector(".children");
  if (childrenContainer) {
    const firstChildEditor =
      childrenContainer.querySelector("[contenteditable]");
    if (firstChildEditor) {
      return firstChildEditor as HTMLElement;
    }
  }

  // Then check for next sibling
  const nextSibling = currentWrapper.nextElementSibling;
  if (nextSibling) {
    const nextEditor = nextSibling.querySelector("[contenteditable]");
    if (nextEditor) {
      return nextEditor as HTMLElement;
    }
  }

  // Finally, traverse up the tree to find next instruction at parent level
  let parentWrapper = currentWrapper.parentElement;
  while (parentWrapper) {
    // If we're in a children container, check the parent's next sibling
    if (parentWrapper.classList.contains("children")) {
      const parentInstructionWrapper = parentWrapper.parentElement;
      if (
        parentInstructionWrapper &&
        parentInstructionWrapper.nextElementSibling
      ) {
        const nextEditor =
          parentInstructionWrapper.nextElementSibling.querySelector(
            "[contenteditable]"
          );
        if (nextEditor) {
          return nextEditor as HTMLElement;
        }
      }
      // Move up one more level
      parentWrapper = parentInstructionWrapper?.parentElement || null;
    } else {
      break;
    }
  }

  return null;
};
</script>

<style scoped>
.instruction-item-wrapper {
  width: 100%;
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
  padding: 0.25rem 0.5rem;
  border: 1px solid transparent;
  outline: none;
  background: transparent;
  resize: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  border-radius: 4px;
  transition: border-color 0.2s ease;
}

.instruction-number {
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  min-width: 1.5rem;
  text-align: right;
  padding-top: 0.375rem;
  user-select: none;
  font-size: 0.875rem;
}

.children {
  margin-left: 1rem;
}
</style>
