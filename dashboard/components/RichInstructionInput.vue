<template>
  <div class="rich-instruction-input"
:data-component-id="componentId">
    <div
      ref="editorRef"
      class="instruction-content"
      :class="{ focused: isFocused }"
      :data-placeholder="placeholder || 'Enter instruction...'"
      contenteditable
      @input="handleInput"
      @keydown="handleKeyDown"
      @focus="handleFocus"
      @blur="handleBlur"
      @paste="handlePaste"
      v-html="renderedContent"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from "vue";
import { useComponentRegistry } from "@/composables/useComponentRegistry";

interface Props {
  modelValue: string;
  placeholder?: string;
  mcpTools: any[];
  documents: any[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "slash-command": [
    data: {
      query: string;
      slashIndex: number;
      textarea: HTMLElement;
      mode?: string;
    },
  ];
  "close-slash-menu": [];
  keydown: [event: KeyboardEvent];
}>();

const editorRef = ref<HTMLElement | null>(null);
const isFocused = ref(false);
const componentId = ref(`rich-input-${Math.random().toString(36).substr(2, 9)}`);
const { registerComponent, unregisterComponent } = useComponentRegistry();

// Convert markdown-like references to visual tags
const renderedContent = computed(() => {
  let content = props.modelValue || "";

  // Replace [action](id) with visual tags
  content = content.replace(/\[action\]\(([^)]+)\)/g, (match, id) => {
    const tool = props.mcpTools.find((t) => t.id === id);
    const name = tool ? tool.name : id;
    return `<span class="mention-merge-field mention-action" data-type="action" data-id="${id}" contenteditable="false">${name}</span>`;
  });

  // Replace [document](id) with visual tags
  content = content.replace(/\[document\]\(([^)]+)\)/g, (match, id) => {
    const doc = props.documents.find((d) => d.id === id);
    const name = doc ? doc.name : id;
    return `<span class="mention-merge-field mention-document" data-type="document" data-id="${id}" contenteditable="false">${name}</span>`;
  });

  // For empty content, let CSS handle the placeholder via :empty pseudo-class
  if (!content.trim()) {
    return "";
  }

  return content;
});

// Convert visual content back to markdown format
const convertToMarkdown = (htmlContent: string): string => {
  let content = htmlContent;

  // Convert action tags back to markdown - more comprehensive regex
  content = content.replace(
    /<span[^>]*class="[^"]*mention-action[^"]*"[^>]*data-id="([^"]+)"[^>]*>.*?<\/span>/g,
    "[action]($1)",
  );
  content = content.replace(
    /<span[^>]*data-id="([^"]+)"[^>]*class="[^"]*mention-action[^"]*"[^>]*>.*?<\/span>/g,
    "[action]($1)",
  );
  content = content.replace(
    /<span[^>]*mention-action[^>]*data-id="([^"]+)"[^>]*>.*?<\/span>/g,
    "[action]($1)",
  );

  // Convert document tags back to markdown - more comprehensive regex
  content = content.replace(
    /<span[^>]*class="[^"]*mention-document[^"]*"[^>]*data-id="([^"]+)"[^>]*>.*?<\/span>/g,
    "[document]($1)",
  );
  content = content.replace(
    /<span[^>]*data-id="([^"]+)"[^>]*class="[^"]*mention-document[^"]*"[^>]*>.*?<\/span>/g,
    "[document]($1)",
  );
  content = content.replace(
    /<span[^>]*mention-document[^>]*data-id="([^"]+)"[^>]*>.*?<\/span>/g,
    "[document]($1)",
  );

  // Parse DOM to handle nested tags properly
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = content;

  // Handle merge fields that may have been rendered as DOM elements
  const actionSpans = tempDiv.querySelectorAll('span[data-type="action"]');
  actionSpans.forEach((span) => {
    const id = span.getAttribute("data-id");
    if (id) {
      const textNode = document.createTextNode(`[action](${id})`);
      span.parentNode?.replaceChild(textNode, span);
    }
  });

  const documentSpans = tempDiv.querySelectorAll('span[data-type="document"]');
  documentSpans.forEach((span) => {
    const id = span.getAttribute("data-id");
    if (id) {
      const textNode = document.createTextNode(`[document](${id})`);
      span.parentNode?.replaceChild(textNode, span);
    }
  });

  // Also handle by class name as fallback
  const actionClassSpans = tempDiv.querySelectorAll("span.mention-action");
  actionClassSpans.forEach((span) => {
    const id = span.getAttribute("data-id");
    if (id) {
      const textNode = document.createTextNode(`[action](${id})`);
      span.parentNode?.replaceChild(textNode, span);
    }
  });

  const documentClassSpans = tempDiv.querySelectorAll("span.mention-document");
  documentClassSpans.forEach((span) => {
    const id = span.getAttribute("data-id");
    if (id) {
      const textNode = document.createTextNode(`[document](${id})`);
      span.parentNode?.replaceChild(textNode, span);
    }
  });

  // Clean up any remaining mcp-merge-field spans that didn't match (fallback)
  content = tempDiv.innerHTML;
  content = content.replace(
    /<span[^>]*class="[^"]*mention-merge-field[^"]*"[^>]*>([^<]+)<\/span>/g,
    "$1",
  );

  // Get the final processed HTML
  tempDiv.innerHTML = content;

  // Convert HTML back to text, preserving line breaks
  let result = "";
  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (element.tagName === "BR") {
        result += "\n";
      } else if (element.tagName === "DIV" && result && !result.endsWith("\n")) {
        result += "\n";
      }

      for (const child of element.childNodes) {
        processNode(child);
      }

      if (element.tagName === "DIV" && !result.endsWith("\n")) {
        result += "\n";
      }
    }
  };

  for (const child of tempDiv.childNodes) {
    processNode(child);
  }

  return result.replace(/\n$/, ""); // Remove trailing newline
};

let isConverting = false;

const handleInput = () => {
  const editor = editorRef.value;
  if (!editor || isConverting) return;

  // Save cursor position before updating
  const selection = window.getSelection();
  let cursorPosition = 0;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    cursorPosition = getTextOffset(editor, range.startContainer, range.startOffset);
  }

  isConverting = true;
  const markdownContent = convertToMarkdown(editor.innerHTML);

  // Only emit if the content has actually changed to prevent unnecessary updates
  if (markdownContent !== props.modelValue) {
    emit("update:modelValue", markdownContent);
  }
  isConverting = false;

  // Restore cursor position after content update
  nextTick(() => {
    if (editor && document.activeElement === editor) {
      setCursorPosition(editor, cursorPosition);
    }
  });

  // Check for slash commands
  checkForSlashCommand();
};

const handleKeyDown = (e: KeyboardEvent) => {
  const editor = editorRef.value;
  if (!editor) return;

  // Always emit keydown for parent to handle navigation
  emit("keydown", e);

  // Check if the parent has handled the event (e.g., for Enter, Tab, etc.)
  if (e.defaultPrevented) {
    return;
  }

  // Handle slash command trigger
  if (e.key === "/") {
    setTimeout(() => {
      checkForSlashCommand();
    }, 10);
    return;
  }

  // Handle shortcuts /a and /d
  if (e.key === "a" || e.key === "d") {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textContent = editor.textContent || "";
      const cursorOffset = getTextOffset(editor, range.startContainer, range.startOffset);

      // Check if we just typed after a slash
      const slashIndex = textContent.lastIndexOf("/", cursorOffset - 1);
      if (slashIndex !== -1) {
        const afterSlash = textContent.slice(slashIndex + 1, cursorOffset);
        if (afterSlash === "") {
          setTimeout(() => {
            checkForSlashCommand();
          }, 10);
          return;
        }
      }
    }
  }

  // Handle space (close menu)
  if (e.key === " ") {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textContent = editor.textContent || "";
      const cursorOffset = getTextOffset(editor, range.startContainer, range.startOffset);

      const slashIndex = textContent.lastIndexOf("/", cursorOffset - 1);
      if (slashIndex !== -1) {
        const afterSlash = textContent.slice(slashIndex + 1, cursorOffset);
        if (!afterSlash.includes(" ")) {
          emit("close-slash-menu");
        }
      }
    }
  }

  // Prevent default behavior when interacting with merge fields
  const target = e.target as HTMLElement;
  if (target.classList?.contains("mention-merge-field")) {
    e.preventDefault();
    return;
  }
};

const checkForSlashCommand = () => {
  const editor = editorRef.value;
  if (!editor) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const textContent = editor.textContent || "";
  const cursorOffset = getTextOffset(editor, range.startContainer, range.startOffset);

  // Find the last "/" before cursor
  const slashIndex = textContent.lastIndexOf("/", cursorOffset - 1);
  if (slashIndex === -1) {
    emit("close-slash-menu");
    return;
  }

  // Get the text after the slash
  const afterSlash = textContent.slice(slashIndex + 1, cursorOffset);

  // Check if it's a potential slash command
  if (afterSlash.includes(" ") || afterSlash.includes("\n")) {
    emit("close-slash-menu");
    return;
  }

  // Determine mode based on shortcuts
  let mode: string | undefined = undefined;
  if (afterSlash === "a") {
    mode = "actions";
  } else if (afterSlash === "d") {
    mode = "documents";
  }

  // Emit slash command event
  emit("slash-command", {
    query: afterSlash,
    slashIndex,
    textarea: editor,
    mode,
  });
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
      const nodeOffset = position - currentOffset;
      range.setStart(node, nodeOffset);
      range.setEnd(node, nodeOffset);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    currentOffset += nodeLength;
  }

  // If we couldn't find the position, set cursor at the end
  if (element.lastChild) {
    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
};

const handlePaste = (e: ClipboardEvent) => {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain") || "";

  // Insert plain text only
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  handleInput();
};

const handleFocus = () => {
  isFocused.value = true;
};

const handleBlur = () => {
  isFocused.value = false;

  const editor = editorRef.value;
  if (editor && !isConverting) {
    // Convert current content to markdown and emit
    isConverting = true;
    const markdownContent = convertToMarkdown(editor.innerHTML);
    if (markdownContent !== props.modelValue) {
      emit("update:modelValue", markdownContent);
    }
    isConverting = false;
  }
};

// Insert action or document reference
const insertReference = (type: "action" | "document", item: any) => {
  const editor = editorRef.value;
  if (!editor) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  // Find and remove the slash command
  const textContent = editor.textContent || "";
  const cursorOffset = getTextOffset(editor, range.startContainer, range.startOffset);
  const slashIndex = textContent.lastIndexOf("/", cursorOffset - 1);

  if (slashIndex !== -1) {
    // Create the visual tag
    const tagElement = document.createElement("span");
    tagElement.className = `mention-merge-field mention-${type}`;
    tagElement.setAttribute("data-type", type);
    tagElement.setAttribute("data-id", item.id);
    tagElement.contentEditable = "false";
    tagElement.innerHTML = item.name;

    // Find the slash position and replace the slash command
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);

    let currentOffset = 0;
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const nodeLength = currentNode.textContent?.length || 0;
      if (currentOffset + nodeLength > slashIndex) {
        // This text node contains the slash
        const nodeSlashIndex = slashIndex - currentOffset;
        const beforeSlash = currentNode.textContent?.slice(0, nodeSlashIndex) || "";
        const afterQuery =
          currentNode.textContent?.slice(nodeSlashIndex + 1 + (cursorOffset - slashIndex - 1)) ||
          "";

        // Replace the text node content
        const newRange = document.createRange();
        newRange.setStart(currentNode, nodeSlashIndex);
        newRange.setEnd(currentNode, nodeSlashIndex + 1 + (cursorOffset - slashIndex - 1));
        newRange.deleteContents();

        // Insert the tag
        newRange.insertNode(tagElement);

        // Insert any remaining text after
        if (afterQuery) {
          const textNode = document.createTextNode(afterQuery);
          tagElement.parentNode?.insertBefore(textNode, tagElement.nextSibling);
        }

        // Position cursor after the tag
        const newRange2 = document.createRange();
        newRange2.setStartAfter(tagElement);
        newRange2.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange2);

        break;
      }
      currentOffset += nodeLength;
    }

    handleInput();
  }
};

// Watch for changes in modelValue
watch(
  () => props.modelValue,
  (newValue) => {
    const editor = editorRef.value;
    if (editor && document.activeElement !== editor && !isConverting) {
      // Only update if not currently focused to avoid cursor issues
      editor.innerHTML = renderedContent.value;
    }
  },
  { flush: "post" },
);

// Register this component instance
onMounted(() => {
  registerComponent(componentId.value, { insertReference });
});

onUnmounted(() => {
  unregisterComponent(componentId.value);
});

// Expose methods for parent component
defineExpose({
  insertReference,
  convertToMarkdown,
});
</script>
