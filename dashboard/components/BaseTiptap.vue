<template>
  <div ref="editorContainer" class="base-tiptap">
    <editor-content :editor="editor" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Editor, EditorContent } from "@tiptap/vue-3";
import type { JSONContent } from "@tiptap/vue-3";
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

interface Props {
  content?: JSONContent;
  placeholder?: string;
  readOnly?: boolean;
  extensions?: AnyExtension[];
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  content: undefined,
  placeholder: "Start typing...",
  readOnly: false,
  editable: true,
});

const emit = defineEmits<{
  ready: [];
  update: [content: JSONContent];
}>();

const editorContainer = ref<HTMLElement | null>(null);
const editor = ref<Editor>();

const initializeEditor = () => {
  const extensions = [
    StarterKit.configure({
      heading: {
        levels: [1, 2],
      },
      orderedList: {
        HTMLAttributes: {
          class: "list-decimal list-inside",
        },
      },
      bulletList: {
        HTMLAttributes: {
          class: "list-disc list-inside",
        },
      },
    }),
    Placeholder.configure({
      placeholder: props.placeholder,
    }),
    ...(props.extensions || []),
  ];

  editor.value = new Editor({
    extensions,
    content: props.content,
    editable: !props.readOnly && props.editable,
    onUpdate: ({ editor }) => {
      emit("update", editor.getJSON());
    },
    onCreate: () => {
      emit("ready");
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor-content",
      },
    },
  });
};

// Watch for changes in content
watch(
  () => props.content,
  (newContent) => {
    if (editor.value && newContent) {
      const currentContent = editor.value.getJSON();
      if (JSON.stringify(currentContent) !== JSON.stringify(newContent)) {
        editor.value.commands.setContent(newContent, false);
      }
    }
  },
  { deep: true },
);

// Watch for changes in editable
watch(
  () => props.editable,
  (newEditable) => {
    if (editor.value) {
      editor.value.setEditable(!props.readOnly && newEditable);
    }
  },
);

onMounted(() => {
  initializeEditor();
});

onUnmounted(() => {
  if (editor.value) {
    editor.value.destroy();
  }
});

// Expose editor instance and methods
defineExpose({
  getEditor: () => editor.value,
  getJSON: () => editor.value?.getJSON() || null,
  getHTML: () => editor.value?.getHTML() || "",
  clear: () => {
    if (editor.value) {
      editor.value.commands.clearContent();
    }
  },
  setContent: (content: JSONContent) => {
    if (editor.value) {
      editor.value.commands.setContent(content);
    }
  },
});
</script>

<style>
.base-tiptap {
  min-height: 200px;
}

/* Tiptap editor content styles */
.tiptap-editor-content {
  outline: none;
  min-height: 200px;
}

.tiptap-editor-content p.is-editor-empty:first-child::before {
  color: var(--color-neutral-muted);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.tiptap-editor-content h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  margin-top: 1rem;
}

.tiptap-editor-content h2 {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  margin-top: 0.75rem;
}

.tiptap-editor-content p {
  margin-bottom: 0.5rem;
}

.tiptap-editor-content ul,
.tiptap-editor-content ol {
  margin-bottom: 0.5rem;
  padding-left: 1.5rem;
}

.tiptap-editor-content li {
  margin-bottom: 0.25rem;

  p {
    display: inline;
  }
}

.tiptap-editor-content strong {
  font-weight: 700;
}

.tiptap-editor-content em {
  font-style: italic;
}

.tiptap-editor-content code {
  background-color: var(--color-muted);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-family: monospace;
  font-size: 0.875em;
}
</style>
